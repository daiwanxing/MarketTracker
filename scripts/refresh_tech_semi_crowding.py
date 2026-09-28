#!/usr/bin/env python3
"""Refresh A-share TMT crowding numbers in src/data/techSemiData.json.

The board only shows TMT turnover share: 申万电子+计算机+传媒+通信成交额
divided by 沪深两市成交额. Sector splits, top names, and heat ratios are not written.

Actions-owned keys: crowding.asOf, label, zone, methodNote, src, turnoverShare.
Narrative keys are left untouched. No null-as-truth. Offline self-test via --self-test.
"""

from __future__ import annotations

import argparse
import json
import ssl
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
TECH_SEMI_PATH = ROOT / "src" / "data" / "techSemiData.json"

SHANGHAI = ZoneInfo("Asia/Shanghai")
UA = "Mozilla/5.0 (compatible; MarketTrackerRefresh/1.0; +https://github.com/daiwanxing/MarketTracker)"

# SW1 Sector nodes in Sina Market_Center
# Verified live against getHQNodes:
# - 电子: sw1_270000 (~519 names)
# - 计算机: sw1_710000 (~357 names)
# - 传媒: sw1_720000 (~131 names)
# - 通信: sw1_730000 (~127 names)
SW1_TMT_NODES: dict[str, str] = {
    "electronics": "sw1_270000",  # 电子
    "computer": "sw1_710000",     # 计算机
    "media": "sw1_720000",        # 传媒
    "telecom": "sw1_730000",      # 通信
}

# Node Chinese names for display & logging
SW1_NAMES: dict[str, str] = {
    "electronics": "电子",
    "computer": "计算机",
    "media": "传媒",
    "telecom": "通信",
}

# Market turnover index feeds
# sh000001 (上证指数) + sz399106 (深证综指) + bj899050 (北证50) from Sina hq feed
MARKET_INDEX_URL = "http://hq.sinajs.cn/list=sh000001,sz399106,bj899050"
TARGET_MARKET_SYMBOLS = {"sh000001", "sz399106", "bj899050"}
SINA_NODE_DATA_URL = "http://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData"
SINA_NODE_COUNT_URL = "http://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeStockCount"
MIN_TMT_STOCKS = 600


@dataclass
class StockItem:
    amount: float


@dataclass
class CrowdingResult:
    as_of: str
    tmt_turnover_share: float
    tmt_amount: float
    market_amount: float
    source_url: str


def log(level: str, message: str) -> None:
    print(f"{level} {message}", flush=True)


def shanghai_now() -> datetime:
    return datetime.now(SHANGHAI)


def _ssl_context() -> ssl.SSLContext | None:
    try:
        import certifi

        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        try:
            return ssl.create_default_context()
        except Exception:
            return None


def http_get(url: str, referer: str | None = None, timeout: int = 15) -> str:
    headers = {"User-Agent": UA}
    if referer:
        headers["Referer"] = referer
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout, context=_ssl_context()) as resp:
        raw = resp.read()
    return raw.decode("gbk", errors="ignore")


def parse_market_turnover(raw: str) -> tuple[float, str]:
    """Parse Sina index quote and sum turnover for sh000001, sz399106, and bj899050."""
    total_amt = 0.0
    date_str = ""
    seen_symbols: set[str] = set()

    for line in raw.strip().split("\n"):
        line = line.strip()
        if not line or "=" not in line:
            continue
        left, _, right = line.partition("=")
        sym = left.replace("var hq_str_", "").strip()
        if sym not in TARGET_MARKET_SYMBOLS:
            continue

        content = right.strip('"; \r\n')
        parts = content.split(",")
        if len(parts) > 30:
            try:
                amt = float(parts[9])
                if amt > 0:
                    total_amt += amt
                    seen_symbols.add(sym)
                if not date_str and parts[30]:
                    date_str = parts[30].strip()
            except (ValueError, IndexError):
                continue

    if "sh000001" not in seen_symbols or "sz399106" not in seen_symbols:
        raise ValueError(
            f"Missing required market turnover symbols in response. Seen: {seen_symbols}"
        )
    if total_amt <= 0:
        raise ValueError("Invalid total market turnover <= 0")

    return total_amt, date_str


def fetch_market_turnover() -> tuple[float, str]:
    """Fetch total market turnover (成交额) in 元 from Sina index quote."""
    raw = http_get(MARKET_INDEX_URL, referer="https://finance.sina.com.cn")
    return parse_market_turnover(raw)


def fetch_sector_stocks(sector_id: str, sector_node: str, max_retries: int = 2) -> list[StockItem]:
    """Fetch all stocks for a given SW1 sector node, paginated."""
    stocks: list[StockItem] = []
    page = 1

    while True:
        query = urllib.parse.urlencode({
            "page": page,
            "num": 100,
            "sort": "amount",
            "asc": 0,
            "node": sector_node,
        })
        url = f"{SINA_NODE_DATA_URL}?{query}"

        items: list | None = None
        for attempt in range(max_retries + 1):
            try:
                raw = http_get(url)
                if not raw or not raw.strip():
                    if page > 1 and attempt < max_retries:
                        time.sleep(0.2 * (attempt + 1))
                        continue
                    items = []
                    break

                parsed = json.loads(raw)
                if not isinstance(parsed, list):
                    if page > 1 and attempt < max_retries:
                        time.sleep(0.2 * (attempt + 1))
                        continue
                    items = []
                    break

                if len(parsed) == 0:
                    if page > 1 and attempt < max_retries:
                        time.sleep(0.15 * (attempt + 1))
                        continue
                    items = []
                    break

                items = parsed
                break
            except Exception as exc:
                if page > 1 and attempt < max_retries:
                    log("WARN", f"Sector {sector_node} page {page} attempt {attempt + 1} failed: {exc}; retrying...")
                    time.sleep(0.2 * (attempt + 1))
                    continue
                elif attempt < max_retries:
                    log("WARN", f"Sector {sector_node} page {page} attempt {attempt + 1} failed: {exc}; retrying...")
                    time.sleep(0.2 * (attempt + 1))
                    continue
                else:
                    log("ERROR", f"Sector {sector_node} page {page} failed after {max_retries + 1} attempts: {exc}")
                    items = None
                    break

        if items is None or not isinstance(items, list):
            break

        if not items:
            break

        for it in items:
            if isinstance(it, dict):
                stocks.append(StockItem(amount=float(it.get("amount") or 0.0)))

        if len(items) < 100:
            break
        page += 1
        time.sleep(0.04)

    return stocks


def compute_crowding_metrics(
    stocks: list[StockItem],
    market_amount: float,
    as_of_date: str,
    min_stocks: int = MIN_TMT_STOCKS,
) -> CrowdingResult:
    if not stocks:
        raise ValueError("No TMT stocks provided")
    if len(stocks) < min_stocks:
        raise ValueError(
            f"Suspiciously low TMT stock count ({len(stocks)}) < minimum threshold ({min_stocks})"
        )
    if market_amount <= 0:
        raise ValueError("market_amount must be > 0")

    tmt_total_amt = sum(s.amount for s in stocks)
    return CrowdingResult(
        as_of=as_of_date,
        tmt_turnover_share=round((tmt_total_amt / market_amount) * 100.0, 2),
        tmt_amount=round(tmt_total_amt / 1e8, 2),
        market_amount=round(market_amount / 1e8, 2),
        source_url="http://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData",
    )


def build_crowding_payload(result: CrowdingResult) -> dict[str, object]:
    share = result.tmt_turnover_share
    if share >= 38.0:
        zone, label = "danger", "极端过热"
    elif share >= 32.0:
        zone, label = "warning", "拥挤偏热"
    elif share >= 20.0:
        zone, label = "neutral", "主线活跃"
    else:
        zone, label = "cold", "低位冰点"

    return {
        "asOf": result.as_of,
        "label": label,
        "zone": zone,
        "methodNote": "申万电子+计算机+传媒+通信成交额 / 沪深两市成交额",
        "turnoverShare": {
            "value": result.tmt_turnover_share,
            "tmtAmountYi": result.tmt_amount,
            "marketAmountYi": result.market_amount,
            "label": "TMT 成交额占比",
            "unit": "%",
            "desc": "申万电子+计算机+传媒+通信四行业成交额合计 / 沪深全市场成交额",
        },
        "src": f"申万一级行业与沪深市场快照 · 新浪行情节点 (asOf: {result.as_of})",
    }


def refresh_tech_semi_crowding(
    dry_run: bool = False,
    data_path: Path | None = None,
    mock_stocks: list[StockItem] | None = None,
    mock_market_amount: float | None = None,
    mock_as_of: str | None = None,
) -> int:
    path = TECH_SEMI_PATH if data_path is None else data_path
    moment = shanghai_now()
    log("INFO", f"tech semi crowding refresh started at {moment.strftime('%Y-%m-%d %H:%M')} Asia/Shanghai")

    if not path.exists():
        log("ERROR", f"{path} does not exist")
        return 1

    with open(path, "r", encoding="utf-8") as f:
        doc = json.load(f)

    try:
        if mock_stocks is not None and mock_market_amount is not None:
            stocks = mock_stocks
            market_amt = mock_market_amount
            as_of_date = mock_as_of or moment.strftime("%Y-%m-%d")
        else:
            market_amt, idx_date = fetch_market_turnover()
            as_of_date = idx_date or moment.strftime("%Y-%m-%d")

            all_stocks: list[StockItem] = []
            for sec_id, sec_node in SW1_TMT_NODES.items():
                sec_list = fetch_sector_stocks(sec_id, sec_node)
                log("INFO", f"Fetched {len(sec_list)} stocks for SW1 {SW1_NAMES[sec_id]} ({sec_node})")
                all_stocks.extend(sec_list)

            stocks = all_stocks

        if len(stocks) < MIN_TMT_STOCKS:
            msg = (
                f"Total fetched TMT stocks ({len(stocks)}) suspiciously low "
                f"(< {MIN_TMT_STOCKS}, expected ~1100). Aborting update to avoid faking cold zone."
            )
            log("ERROR", msg)
            raise ValueError(msg)

        crowd_res = compute_crowding_metrics(stocks, market_amt, as_of_date)
        crowding_dict = build_crowding_payload(crowd_res)

        # Update doc with new crowding object
        doc["crowding"] = crowding_dict
        doc.pop("crowdingProxy", None)

        if dry_run:
            log("INFO", f"dry-run: computed crowding metrics for {as_of_date}")
            log("INFO", f"  TMT turnover share: {crowd_res.tmt_turnover_share}%")
        else:
            with tempfile.NamedTemporaryFile("w", dir=path.parent, delete=False, encoding="utf-8") as tmp:
                json.dump(doc, tmp, ensure_ascii=False, indent=2)
                tmp.write("\n")
                tmp_path = Path(tmp.name)
            tmp_path.replace(path)
            log("INFO", f"wrote {path.name} with updated crowding metrics ({as_of_date})")

        return 0

    except Exception as e:
        log("WARN", f"Failed to refresh TMT crowding metrics: {e}; preserving existing values")
        return 0  # Fail soft, do not crash CI workflow, keep prior values


def self_test() -> int:
    """Run offline self-test with mock data fixtures."""
    log("INFO", "running refresh_tech_semi_crowding self-test...")

    # 1. Test market turnover parsing with sh000001, sz399106, and bj899050
    mock_raw_hq = (
        'var hq_str_sh000001="上证指数,3878.4,3888.3,3823.6,3878.4,3806.6,0,0,452350675,800000000000,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2026-09-28,15:35:31,00,";\n'
        'var hq_str_sz399106="深证综指,2469.5,2476.0,2400.1,2469.7,2388.6,0.0,0.0,54017426672,900000000000,0,0.0,0,0.0,0,0.0,0,0.0,0,0.0,0,0.0,0,0.0,0,0.0,0,0.0,0,0.0,2026-09-28,15:00:03,00";\n'
        'var hq_str_bj899050="北证50,1057.3,1055.7,1026.5,1057.6,1023.1,0.0,0.0,621598978,15000000000,0,0.0,0,0.0,0,0.0,0,0.0,0,0.0,0,0.0,0,0.0,0,0.0,0,0.0,0,0.0,2026-09-28,15:30:02,00,0,0,0,0,,";\n'
        'var hq_str_ignored="无关代码,0,0,0,0,0,0,0,0,999999999,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2026-09-28,15:00:00,00";\n'
    )
    amt, date_str = parse_market_turnover(mock_raw_hq)
    expected_amt = 800000000000.0 + 900000000000.0 + 15000000000.0
    assert abs(amt - expected_amt) < 1e-4, f"Turnover mismatch: got {amt}, expected {expected_amt}"
    assert date_str == "2026-09-28", f"Date mismatch: got {date_str}"

    # Missing required symbol should raise ValueError
    try:
        parse_market_turnover('var hq_str_sh000001="...,0,0,0,0,0,0,0,0,800000000000,...";\n')
        raise AssertionError("Expected ValueError when sz399106 is missing")
    except ValueError:
        pass

    # 2. Test low stock count validation
    try:
        compute_crowding_metrics([StockItem(amount=100.0)] * 50, 100000.0, "2026-09-24")
        raise AssertionError("Expected ValueError when TMT stock count < MIN_TMT_STOCKS")
    except ValueError:
        pass

    # 3. Test full refresh with >= 600 mock stocks
    mock_stocks = [
        StockItem(amount=100.0 + (i % 20) * 10.0) for i in range(650)
    ]

    market_amount = 1000000.0  # Total market amount
    doc = {
        "snapshot": "2026-09-24 15:30",
        "head": {"title": "科技半导体", "sub": "保留不改的叙述"},
        "signal": {"verdict": "叙述保持"},
        "benchmarks": {},
        "charts": {},
        "crowdingProxy": {},
    }

    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as tmp:
        json.dump(doc, tmp, ensure_ascii=False)
        test_file = Path(tmp.name)

    try:
        status = refresh_tech_semi_crowding(
            dry_run=False,
            data_path=test_file,
            mock_stocks=mock_stocks,
            mock_market_amount=market_amount,
            mock_as_of="2026-09-24",
        )
        if status != 0:
            raise AssertionError(f"Expected status 0, got {status}")

        with open(test_file, "r", encoding="utf-8") as f:
            updated = json.load(f)

        assert updated["head"]["sub"] == "保留不改的叙述", "narrative untouched"
        assert updated["signal"]["verdict"] == "叙述保持", "signal untouched"
        assert "crowding" in updated, "crowding key exists"
        cr = updated["crowding"]
        assert cr["asOf"] == "2026-09-24", "asOf matches"
        assert cr["turnoverShare"]["value"] > 0, "turnoverShare value > 0"
        assert "top5Concentration" not in cr
        assert "circulatingHeatRatio" not in cr
        assert "sectorBreakdown" not in cr
        assert "topStocks" not in cr
        assert "crowdingProxy" not in updated, "legacy proxy removed"
        assert cr["label"] in {"低位冰点", "主线活跃", "拥挤偏热", "极端过热"}

        # Verify fail-soft on suspicious stock count < MIN_TMT_STOCKS
        low_stocks = [StockItem(amount=100.0) for _ in range(50)]
        status_low = refresh_tech_semi_crowding(
            dry_run=False,
            data_path=test_file,
            mock_stocks=low_stocks,
            mock_market_amount=market_amount,
            mock_as_of="2026-09-25",
        )
        assert status_low == 0, "fail soft status 0"
        with open(test_file, "r", encoding="utf-8") as f:
            preserved = json.load(f)
        assert preserved["crowding"]["asOf"] == "2026-09-24", "preserved previous data on low stock count"

        log("INFO", "self-test passed successfully!")
    finally:
        if test_file.exists():
            test_file.unlink()

    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--self-test",
        action="store_true",
        help="Run offline self-test with fixture data and exit.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Compute updates but do not write to file.",
    )
    args = parser.parse_args()

    if args.self_test:
        return self_test()

    return refresh_tech_semi_crowding(dry_run=args.dry_run)


if __name__ == "__main__":
    sys.exit(main())
