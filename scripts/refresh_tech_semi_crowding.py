#!/usr/bin/env python3
"""Refresh A-share TMT crowding numbers in src/data/techSemiData.json.

Phase 2 MVP: A-share TMT crowding metrics fetched from public Sina HQ node APIs.
Metrics computed:
1. TMT turnover share: sum of daily成交额 for SW1 sectors 电子+计算机+传媒+通信,
   divided by 沪深A (hs_a) total成交额 (using SH+SZ composite market turnover).
2. Top-5% concentration: among the TMT universe (SW1 4 sectors sorted by amount desc),
   share of 成交额 held by the top 5% names by amount.
3. Circulating heat ratio (流通换手口径): TMT 成交额 / TMT 流通市值 (from Sina nmc fields),
   labeled explicitly as 流通口径 not 自由流通.

Robustness principles:
- Actions-owned numeric keys only (crowding.*).
- Narrative keys (head, signal, timeline, news, risks, footer, etc.) are strictly left untouched.
- No null-as-truth: on failure WARN + keep prior values.
- Offline self-test mode (--self-test).
"""

from __future__ import annotations

import argparse
import json
import math
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
# sh000001 (上证指数) + sz399001 (深证成指) from Sina hq feed
# Alternatively sh000002 (上证A指) + sz399107 (深证A指)
MARKET_INDEX_URL = "http://hq.sinajs.cn/list=sh000001,sz399001"
SINA_NODE_DATA_URL = "http://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData"
SINA_NODE_COUNT_URL = "http://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeStockCount"


@dataclass
class StockItem:
    code: str
    name: str
    sector: str
    sector_id: str
    amount: float      # 成交额 (元)
    nmc: float         # 流通市值 (元)
    mktcap: float      # 总市值 (元)


@dataclass
class CrowdingResult:
    as_of: str
    tmt_turnover_share: float         # %
    tmt_amount: float                 # 元
    market_amount: float              # 元
    top5pct_concentration: float      # %
    top5pct_amount: float             # 元
    top5pct_count: int
    tmt_stock_count: int
    circulating_heat_ratio: float     # % (流通换手口径)
    tmt_nmc: float                    # 元 (流通市值)
    sector_breakdown: dict[str, dict[str, float]]
    top_stocks: list[dict[str, object]]
    source_url: str


def log(level: str, message: str) -> None:
    print(f"{level} {message}", flush=True)


def shanghai_now() -> datetime:
    return datetime.now(SHANGHAI)


def http_get(url: str, referer: str | None = None, timeout: int = 15) -> str:
    headers = {"User-Agent": UA}
    if referer:
        headers["Referer"] = referer
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read()
    return raw.decode("gbk", errors="ignore")


def fetch_market_turnover() -> tuple[float, str]:
    """Fetch total market turnover (成交额) in 元 from Sina index quote."""
    raw = http_get(MARKET_INDEX_URL, referer="https://finance.sina.com.cn")
    total_amt = 0.0
    date_str = ""
    for line in raw.strip().split("\n"):
        parts = line.split(",")
        if len(parts) > 30:
            # Field 9 is turnover amount in RMB (元)
            amt = float(parts[9])
            total_amt += amt
            if not date_str and parts[30]:
                date_str = parts[30]
    if total_amt <= 0:
        raise ValueError("Invalid total market turnover <= 0")
    return total_amt, date_str


def fetch_sector_stocks(sector_id: str, sector_node: str) -> list[StockItem]:
    """Fetch all stocks for a given SW1 sector node, paginated."""
    stocks: list[StockItem] = []
    page = 1
    sector_name = SW1_NAMES.get(sector_id, sector_id)

    while True:
        query = urllib.parse.urlencode({
            "page": page,
            "num": 100,
            "sort": "amount",
            "asc": 0,
            "node": sector_node,
        })
        url = f"{SINA_NODE_DATA_URL}?{query}"
        raw = http_get(url)
        items = json.loads(raw)
        if not items or not isinstance(items, list):
            break

        for it in items:
            code = str(it.get("code") or "")
            name = str(it.get("name") or "")
            amt = float(it.get("amount") or 0.0)
            # Sina nmc and mktcap are in 万元, convert to 元
            nmc_wan = float(it.get("nmc") or 0.0)
            mktcap_wan = float(it.get("mktcap") or 0.0)

            stocks.append(
                StockItem(
                    code=code,
                    name=name,
                    sector=sector_name,
                    sector_id=sector_id,
                    amount=amt,
                    nmc=nmc_wan * 10000.0,
                    mktcap=mktcap_wan * 10000.0,
                )
            )

        if len(items) < 100:
            break
        page += 1
        time.sleep(0.04)

    return stocks


def compute_crowding_metrics(
    stocks: list[StockItem],
    market_amount: float,
    as_of_date: str,
) -> CrowdingResult:
    """Compute Phase-2 TMT crowding metrics from stocks and market turnover."""
    tmt_stock_count = len(stocks)
    if tmt_stock_count == 0:
        raise ValueError("No TMT stocks provided")

    tmt_total_amt = sum(s.amount for s in stocks)
    tmt_total_nmc = sum(s.nmc for s in stocks)

    if market_amount <= 0:
        raise ValueError("market_amount must be > 0")

    tmt_turnover_share = round((tmt_total_amt / market_amount) * 100.0, 2)

    # Sort TMT universe by amount descending
    sorted_stocks = sorted(stocks, key=lambda s: s.amount, reverse=True)
    top5pct_count = max(1, round(tmt_stock_count * 0.05))
    top5pct_amt = sum(s.amount for s in sorted_stocks[:top5pct_count])
    top5pct_concentration = round(
        (top5pct_amt / tmt_total_amt * 100.0) if tmt_total_amt > 0 else 0.0,
        2,
    )

    circulating_heat_ratio = round(
        (tmt_total_amt / tmt_total_nmc * 100.0) if tmt_total_nmc > 0 else 0.0,
        2,
    )

    # Sector breakdown
    sector_breakdown: dict[str, dict[str, float]] = {}
    for sec_id, sec_name in SW1_NAMES.items():
        sec_stocks = [s for s in stocks if s.sector_id == sec_id]
        sec_amt = sum(s.amount for s in sec_stocks)
        sec_nmc = sum(s.nmc for s in sec_stocks)
        sec_share = round((sec_amt / market_amount) * 100.0, 2)
        sec_heat = round((sec_amt / sec_nmc * 100.0) if sec_nmc > 0 else 0.0, 2)
        sector_breakdown[sec_id] = {
            "name": sec_name,
            "count": len(sec_stocks),
            "amountYi": round(sec_amt / 1e8, 2),
            "share": sec_share,
            "heatRatio": sec_heat,
        }

    # Top 10 stocks by turnover
    top_stocks = [
        {
            "code": s.code,
            "name": s.name,
            "sector": s.sector,
            "amountYi": round(s.amount / 1e8, 2),
        }
        for s in sorted_stocks[:10]
    ]

    return CrowdingResult(
        as_of=as_of_date,
        tmt_turnover_share=tmt_turnover_share,
        tmt_amount=round(tmt_total_amt / 1e8, 2),
        market_amount=round(market_amount / 1e8, 2),
        top5pct_concentration=top5pct_concentration,
        top5pct_amount=round(top5pct_amt / 1e8, 2),
        top5pct_count=top5pct_count,
        tmt_stock_count=tmt_stock_count,
        circulating_heat_ratio=circulating_heat_ratio,
        tmt_nmc=round(tmt_total_nmc / 1e8, 2),
        sector_breakdown=sector_breakdown,
        top_stocks=top_stocks,
        source_url="http://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData",
    )


def build_crowding_payload(result: CrowdingResult) -> dict[str, object]:
    """Build the machine-readable crowding dictionary for techSemiData.json."""
    # Determine qualitative crowding zone based on TMT turnover share
    # Historical A-share rules of thumb:
    # < 20%: cold / 低拥挤
    # 20% - 30%: normal / 中性
    # 30% - 38%: warm / 偏热关注
    # >= 38%: hot / 高拥挤过热警示
    share = result.tmt_turnover_share
    if share >= 38.0:
        zone = "danger"
        label = "高拥挤过热"
    elif share >= 30.0:
        zone = "warning"
        label = "偏热关注"
    elif share >= 20.0:
        zone = "neutral"
        label = "中性合理"
    else:
        zone = "cold"
        label = "偏低清淡"

    return {
        "asOf": result.as_of,
        "label": label,
        "zone": zone,
        "methodNote": "基于申万一级行业（电子/计算机/传媒/通信）全成分股实时成交汇总与沪深两市整体成交额实测，流通口径热度基于全流通市值计算",
        "turnoverShare": {
            "value": result.tmt_turnover_share,
            "tmtAmountYi": result.tmt_amount,
            "marketAmountYi": result.market_amount,
            "label": "TMT 成交额占比",
            "unit": "%",
            "desc": "申万电子+计算机+传媒+通信四行业成交额合计 / 沪深全市场成交额",
        },
        "top5Concentration": {
            "value": result.top5pct_concentration,
            "top5AmountYi": result.top5pct_amount,
            "top5Count": result.top5pct_count,
            "totalTmtCount": result.tmt_stock_count,
            "label": "TMT Top 5% 成交集中度",
            "unit": "%",
            "desc": f"TMT 宇宙内成交额前 5% 头部标的（{result.top5pct_count} 只）成交额合计占 TMT 总成交比例",
        },
        "circulatingHeatRatio": {
            "value": result.circulating_heat_ratio,
            "tmtNmcYi": result.tmt_nmc,
            "label": "TMT 流通热度比率",
            "unit": "%",
            "desc": "TMT 板块单日成交额 / TMT 流通市值合计（注：流通口径换手，非自由流通口径）",
            "scopeLabel": "流通口径",
        },
        "sectorBreakdown": result.sector_breakdown,
        "topStocks": result.top_stocks,
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

        crowd_res = compute_crowding_metrics(stocks, market_amt, as_of_date)
        crowding_dict = build_crowding_payload(crowd_res)

        # Update doc with new crowding object
        doc["crowding"] = crowding_dict

        # Keep crowdingProxy updated with real numbers or demoted legacy note
        doc["crowdingProxy"] = {
            "score": int(min(100, max(0, round(crowd_res.tmt_turnover_share * 2.5)))),
            "label": crowding_dict["label"],
            "zone": crowding_dict["zone"],
            "asOf": crowd_res.as_of,
            "methodNote": "已升级为 Phase-2 真实 A 股 TMT 成交占比与集中度测算（详情参见上方真实拥挤度指标卡）",
            "cards": {
                "tmtTurnoverShare": crowd_res.tmt_turnover_share,
                "top5Concentration": crowd_res.top5pct_concentration,
                "circulatingHeatRatio": crowd_res.circulating_heat_ratio,
            },
        }

        if dry_run:
            log("INFO", f"dry-run: computed crowding metrics for {as_of_date}")
            log("INFO", f"  TMT turnover share: {crowd_res.tmt_turnover_share}%")
            log("INFO", f"  Top 5% concentration: {crowd_res.top5pct_concentration}%")
            log("INFO", f"  Circulating heat ratio: {crowd_res.circulating_heat_ratio}%")
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

    mock_stocks: list[StockItem] = []
    # 20 stocks in electronics
    for i in range(20):
        mock_stocks.append(
            StockItem(
                code=f"600{i:03d}",
                name=f"电子标的{i}",
                sector="电子",
                sector_id="electronics",
                amount=100.0 * (20 - i),
                nmc=10000.0 * (20 - i),
                mktcap=12000.0 * (20 - i),
            )
        )
    # 15 stocks in computer
    for i in range(15):
        mock_stocks.append(
            StockItem(
                code=f"300{i:03d}",
                name=f"计算机标的{i}",
                sector="计算机",
                sector_id="computer",
                amount=50.0 * (15 - i),
                nmc=5000.0 * (15 - i),
                mktcap=6000.0 * (15 - i),
            )
        )
    # 10 stocks in media
    for i in range(10):
        mock_stocks.append(
            StockItem(
                code=f"002{i:03d}",
                name=f"传媒标的{i}",
                sector="传媒",
                sector_id="media",
                amount=30.0 * (10 - i),
                nmc=3000.0 * (10 - i),
                mktcap=4000.0 * (10 - i),
            )
        )
    # 10 stocks in telecom
    for i in range(10):
        mock_stocks.append(
            StockItem(
                code=f"688{i:03d}",
                name=f"通信标的{i}",
                sector="通信",
                sector_id="telecom",
                amount=80.0 * (10 - i),
                nmc=8000.0 * (10 - i),
                mktcap=9000.0 * (10 - i),
            )
        )

    market_amount = 100000.0  # Total market amount
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
        assert cr["top5Concentration"]["value"] > 0, "top5Concentration value > 0"
        assert cr["circulatingHeatRatio"]["value"] > 0, "circulatingHeatRatio value > 0"
        assert "electronics" in cr["sectorBreakdown"], "sectorBreakdown has electronics"
        assert len(cr["topStocks"]) == 10, "topStocks has 10 items"
        assert "流通口径" in cr["circulatingHeatRatio"]["scopeLabel"], "explicit scope label"
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
