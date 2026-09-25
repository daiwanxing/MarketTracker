#!/usr/bin/env python3
"""Refresh tech semiconductor numeric fields in techSemiData.json.

Actions-owned keys only: snapshot, benchmarks (SOX / 科创50 / 芯片ETF),
charts.normalized, and leverage.marginBuyShare (全市场融资买入额 / 同日两市成交额).
Narrative keys (head, signal, anomalies, leverage.note, marginBuyShare.k/metric/watch,
fundamental, timeline, news, risks, footer) are left untouched.
No null-as-truth; WARN and keep the prior value on failure.
"""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
TECH_SEMI_PATH = ROOT / "src" / "data" / "techSemiData.json"

SHANGHAI = ZoneInfo("Asia/Shanghai")
YAHOO_HOSTS = ("query1.finance.yahoo.com", "query2.finance.yahoo.com")
UA = "Mozilla/5.0 (compatible; MarketTrackerRefresh/1.0; +https://github.com/daiwanxing/MarketTracker)"

# Sanity ranges for sanity checks
RANGES = {
    "^SOX": (1000.0, 50000.0),
    "000688.SS": (200.0, 10000.0),
    "588000.SS": (0.1, 50.0),
    "512480.SS": (0.1, 50.0),
}

BENCHMARKS = {
    "sox": ("^SOX", "费城半导体指数", 2),
    "star50": ("000688.SS", "科创50指数", 2),
    "chip_etf": ("512480.SS", "中证半导体ETF", 3),
}
CHART_KEYS = ("sox", "star50", "chip_etf")
STALE_BENCHMARKS = ("ndx", "hstech", "csi300", "nvda", "tsm")


@dataclass
class Bar:
    session: date
    open: float | None
    high: float | None
    low: float | None
    close: float | None
    volume: float | None


@dataclass
class Quote:
    symbol: str
    price: float
    previous_close: float | None
    open: float | None
    high: float | None
    low: float | None
    session: date
    bars: dict[date, Bar]
    source: str


def log(level: str, message: str) -> None:
    print(f"{level} {message}", flush=True)


def http_json(url: str, extra_headers: dict[str, str] | None = None) -> object:
    headers = {"User-Agent": UA, "Accept": "application/json,text/plain,*/*"}
    if extra_headers:
        headers.update(extra_headers)
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=25) as resp:
        raw = resp.read()
    return json.loads(raw.decode("utf-8"))


def _num(value: object) -> float | None:
    if value is None or isinstance(value, bool) or isinstance(value, str):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number or number in (float("inf"), float("-inf")):
        return None
    return number


def shanghai_now() -> datetime:
    return datetime.now(SHANGHAI)


def snapshot_stamp(moment: datetime) -> str:
    return moment.strftime("%Y-%m-%d %H:%M")


def bars_from_yahoo(result: dict) -> tuple[dict[date, Bar], date, float]:
    meta = result["meta"]
    tz = ZoneInfo(meta.get("exchangeTimezoneName") or "America/New_York")
    quote = (result.get("indicators") or {}).get("quote", [{}])[0]
    stamps = result.get("timestamp") or []
    grouped: dict[date, list[tuple[datetime, float | None, float | None, float | None, float | None, float | None]]] = {}
    for i, ts in enumerate(stamps):
        moment = datetime.fromtimestamp(int(ts), tz)

        def at(key: str, index: int = i) -> float | None:
            series = quote.get(key) or []
            return _num(series[index] if index < len(series) else None)

        grouped.setdefault(moment.date(), []).append(
            (moment, at("open"), at("high"), at("low"), at("close"), at("volume"))
        )
    for rows in grouped.values():
        rows.sort(key=lambda row: row[0])

    official: dict[date, Bar] = {}
    for day, rows in grouped.items():
        _moment, opened, high, low, close, volume = rows[0]
        official[day] = Bar(day, opened, high, low, close, volume)

    price = _num(meta.get("regularMarketPrice"))
    market_time = meta.get("regularMarketTime")
    if price is None or not isinstance(market_time, int):
        raise ValueError("Yahoo payload has no regularMarketPrice")
    live_moment = datetime.fromtimestamp(market_time, tz)
    live_date = live_moment.date()

    bars: dict[date, Bar] = {
        day: bar for day, bar in official.items() if bar.close is not None and day != live_date
    }
    official_today = official.get(live_date)
    opened = official_today.open if official_today else None
    high = official_today.high if official_today else None
    low = official_today.low if official_today else None
    volume = official_today.volume if official_today else None
    day_high = _num(meta.get("regularMarketDayHigh"))
    day_low = _num(meta.get("regularMarketDayLow"))
    if day_high is not None:
        high = day_high if high is None else max(high, day_high)
    if day_low is not None:
        low = day_low if low is None else min(low, day_low)
    bars[live_date] = Bar(live_date, opened, high, low, price, volume)

    return bars, live_date, price


def fetch_yahoo(symbol: str, range_param: str = "5d") -> Quote:
    encoded = urllib.parse.quote(symbol, safe="")
    errors: list[str] = []
    for host in YAHOO_HOSTS:
        url = f"https://{host}/v8/finance/chart/{encoded}?interval=1d&range={range_param}"
        try:
            payload = http_json(url)
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as exc:
            errors.append(f"{host}: {exc}")
            continue
        chart = payload.get("chart") if isinstance(payload, dict) else None
        result = (chart or {}).get("result") if isinstance(chart, dict) else None
        if not result:
            err = (chart or {}).get("error") if isinstance(chart, dict) else None
            errors.append(f"{host}: {err or 'empty result'}")
            continue
        meta = result[0].get("meta", {})
        try:
            bars, session, price = bars_from_yahoo(result[0])
        except (KeyError, TypeError, ValueError) as exc:
            errors.append(f"{host}: {exc}")
            continue

        prev_close = _num(meta.get("previousClose") or meta.get("chartPreviousClose"))
        if range_param != "5d" or prev_close is None:
            earlier = [d for d in bars if d < session and bars[d].close is not None]
            if earlier:
                prev_close = bars[max(earlier)].close

        lo, hi = RANGES.get(symbol, (None, None))
        if lo is not None and not (lo <= price <= hi):
            raise ValueError(f"{symbol} price {price} outside {lo}..{hi}")

        bar = bars.get(session)
        log("INFO", f"fetched {symbol} {price} session {session.isoformat()} via {url}")
        return Quote(
            symbol=symbol,
            price=price,
            previous_close=prev_close,
            open=bar.open if bar else None,
            high=bar.high if bar else None,
            low=bar.low if bar else None,
            session=session,
            bars=bars,
            source=f"Yahoo Finance ({symbol})",
        )
    raise RuntimeError(f"{symbol} failed ({'; '.join(errors)})")


def try_fetch(symbol: str, failures: list[str], range_param: str = "6mo") -> Quote | None:
    try:
        return fetch_yahoo(symbol, range_param=range_param)
    except Exception as exc:  # noqa: BLE001
        failures.append(f"{symbol}: {exc}")
        log("WARN", f"{symbol} unavailable: {exc}")
        return None


def format_change(price: float, prev_close: float | None) -> tuple[str, str]:
    if prev_close is None or prev_close <= 0:
        return "", ""
    diff = price - prev_close
    pct = (diff / prev_close) * 100.0
    sign = "+" if pct > 0 else ""
    pct_str = f"{sign}{pct:.2f}%"
    chg_class = "up" if pct > 0 else ("down" if pct < 0 else "")
    return pct_str, chg_class


def quote_record(q: Quote, name: str, ndigits: int, moment: datetime) -> dict:
    pct_str, chg_cls = format_change(q.price, q.previous_close)
    prev = round(q.previous_close, ndigits) if q.previous_close else None
    return {
        "name": name,
        "symbol": q.symbol,
        "price": round(q.price, ndigits),
        "chg": pct_str,
        "chgClass": chg_cls,
        "previousClose": prev,
        "src": f"{q.symbol} {moment.strftime('%m-%d %H:%M')} 上海 · {q.source}",
    }


def update_quotes(
    bucket: dict,
    quotes: dict[str, Quote | None],
    meta: dict[str, tuple[str, str, int]],
    moment: datetime,
) -> list[str]:
    updated: list[str] = []
    for key, (sym, name, ndigits) in meta.items():
        q = quotes.get(key)
        if q is None:
            log("WARN", f"{key} ({sym}) unavailable; preserving existing numbers")
            continue
        bucket[key] = quote_record(q, name, ndigits, moment)
        updated.append(key)
    return updated


def update_benchmarks(
    doc: dict,
    quotes: dict[str, Quote | None],
    moment: datetime,
) -> list[str]:
    benchmarks = doc.setdefault("benchmarks", {})
    for stale in STALE_BENCHMARKS:
        benchmarks.pop(stale, None)
    doc.pop("crowdingProxy", None)
    doc.pop("liquidity", None)
    charts = doc.get("charts")
    if isinstance(charts, dict):
        charts.pop("ratios", None)
    return [f"benchmarks.{key}" for key in update_quotes(benchmarks, quotes, BENCHMARKS, moment)]


def align_closes(q: Quote, anchor_dates: list[date]) -> list[float] | None:
    if not q.bars:
        return None
    sorted_days = sorted(q.bars.keys())
    last_close = q.bars[sorted_days[0]].close or q.price
    aligned: list[float] = []
    idx = 0
    for ad in anchor_dates:
        while idx < len(sorted_days) and sorted_days[idx] <= ad:
            close = q.bars[sorted_days[idx]].close
            if close is not None:
                last_close = close
            idx += 1
        aligned.append(last_close)
    return aligned


def update_normalized(
    doc: dict,
    history_quotes: dict[str, Quote | None],
) -> list[str]:
    """Normalized percent change from the first SOX session in the last ~6 months."""
    sox_q = history_quotes.get("sox")
    if sox_q is None:
        log("WARN", "SOX history unavailable; normalized chart preserved")
        return []
    sox_dates = sorted(sox_q.bars.keys())
    if len(sox_dates) < 20:
        log("WARN", "SOX history too short; normalized chart preserved")
        return []
    anchor_dates = sox_dates[-125:]
    normalized: dict[str, list[float]] = {}
    for skey in CHART_KEYS:
        q = history_quotes.get(skey)
        if q is None:
            continue
        aligned = align_closes(q, anchor_dates)
        if not aligned or aligned[0] <= 0:
            continue
        base = aligned[0]
        normalized[skey] = [round(((val / base) - 1.0) * 100.0, 2) for val in aligned]
    charts = doc.setdefault("charts", {})
    charts.pop("ratios", None)
    charts["normalized"] = {
        "dates": [d.strftime("%m-%d") for d in anchor_dates],
        **{key: normalized.get(key, []) for key in CHART_KEYS},
    }
    return ["charts.normalized"]


MARGIN_URL = (
    "https://datacenter-web.eastmoney.com/api/data/v1/get"
    "?reportName=RPTA_RZRQ_LSHJ&columns=DIM_DATE,RZMRE"
    "&pageSize=8&pageNumber=1&sortColumns=DIM_DATE&sortTypes=-1"
)
TURNOVER_URL = (
    "https://proxy.finance.qq.com/ifzqgtimg/appstock/app/newfqkline/get"
    "?param={code},day,,,12,qfq"
)
EASTMONEY_HEADERS = {
    "Referer": "https://data.eastmoney.com/",
    "User-Agent": "Mozilla/5.0 (compatible; MarketTrackerRefresh/1.0)",
}


def classify_margin_share(share: float) -> tuple[str, str]:
    """Market-wide bands. 7–9% is the ordinary range; 15% is not used here."""
    if share < 7:
        return "cold", "低于平常"
    if share <= 9:
        return "neutral", "平常"
    return "warning", "高于平常"


def match_margin_share(
    buys: list[tuple[str, float]],
    turnover: dict[str, float],
) -> dict[str, object] | None:
    """Pair 融资买入额 with the same day's 上证+深证成指成交额. Both amounts are yuan."""
    for day, buy in buys:
        market = turnover.get(day)
        if buy <= 0 or market is None or market <= 0:
            continue
        share = round(buy / market * 100.0, 2)
        if not 0.5 <= share <= 30:
            log("WARN", f"margin share {share} on {day} outside 0.5..30; skipping")
            continue
        zone, label = classify_margin_share(share)
        return {
            "value": share,
            "asOf": day,
            "buyYi": round(buy / 1e8, 2),
            "marketAmountYi": round(market / 1e8, 2),
            "zone": zone,
            "v": label,
            "status": "live",
            "src": f"东方财富融资买入额 / 腾讯日K上证+深证成指成交额 · {day}",
        }
    return None


def update_margin_buy_share(
    doc: dict,
    buys: list[tuple[str, float]],
    turnover: dict[str, float],
) -> list[str]:
    payload = match_margin_share(buys, turnover)
    if payload is None:
        log("WARN", "margin buy share unavailable; preserving existing numbers")
        return []
    card = doc.setdefault("leverage", {}).setdefault("marginBuyShare", {})
    card.update(payload)
    return ["leverage.marginBuyShare"]


def fetch_margin_inputs(failures: list[str]) -> tuple[list[tuple[str, float]], dict[str, float]] | None:
    try:
        payload = http_json(MARGIN_URL, EASTMONEY_HEADERS)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as exc:
        failures.append(f"margin: {exc}")
        log("WARN", f"margin summary unavailable: {exc}")
        return None
    result = payload.get("result") if isinstance(payload, dict) else None
    rows = result.get("data") if isinstance(result, dict) else None
    if not rows:
        failures.append("margin: empty")
        log("WARN", "margin summary empty; preserving existing numbers")
        return None
    buys: list[tuple[str, float]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        raw_day = row.get("DIM_DATE")
        buy = _num(row.get("RZMRE"))
        if not isinstance(raw_day, str) or buy is None:
            continue
        buys.append((raw_day[:10], buy))
    turnover: dict[str, float] = {}
    for code in ("sh000001", "sz399001"):
        url = TURNOVER_URL.format(code=code)
        try:
            payload = http_json(url)
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as exc:
            failures.append(f"turnover {code}: {exc}")
            log("WARN", f"turnover {code} unavailable: {exc}")
            return None
        data = payload.get("data") if isinstance(payload, dict) else None
        node = data.get(code) if isinstance(data, dict) else None
        lines = node.get("day") if isinstance(node, dict) else None
        if not lines:
            failures.append(f"turnover {code}: empty")
            log("WARN", f"turnover {code} empty; preserving existing numbers")
            return None
        for line in lines:
            if not isinstance(line, list) or len(line) < 9:
                continue
            # Column 8 is 成交额 in 万元.
            raw = line[8]
            if isinstance(raw, str):
                try:
                    raw = float(raw)
                except ValueError:
                    continue
            amount_wan = _num(raw)
            if amount_wan is None:
                continue
            day = str(line[0])
            turnover[day] = turnover.get(day, 0.0) + amount_wan * 10000.0
    return buys, turnover


def refresh_tech_semi(
    dry_run: bool = False,
    data_path: Path | None = None,
    mock_quotes: dict[str, Quote | None] | None = None,
    mock_history: dict[str, Quote | None] | None = None,
    mock_margin: tuple[list[tuple[str, float]], dict[str, float]] | None = None,
) -> int:
    path = TECH_SEMI_PATH if data_path is None else data_path
    moment = shanghai_now()
    log("INFO", f"tech semi refresh started at {snapshot_stamp(moment)} Asia/Shanghai")

    failures: list[str] = []

    if mock_quotes is not None and mock_history is not None:
        quotes = mock_quotes
        history = mock_history
    else:
        spot = {
            "sox": "^SOX",
            "star50": "000688.SS",
            "chip_etf": "512480.SS",
        }
        quotes = {key: try_fetch(sym, failures, "5d") for key, sym in spot.items()}
        hist_symbols = {
            "sox": "^SOX",
            "star50": "588000.SS",
            "chip_etf": "512480.SS",
        }
        history = {
            key: try_fetch(sym, failures, "6mo") or quotes.get(key)
            for key, sym in hist_symbols.items()
        }

    # If primary benchmark (SOX) completely failed, do not overwrite snapshot as truth
    if quotes.get("sox") is None:
        log("ERROR", "total failure: SOX quote failed")
        return 1

    if not path.exists():
        log("ERROR", f"{path} does not exist")
        return 1

    with open(path, "r", encoding="utf-8") as f:
        doc = json.load(f)

    updated_fields: list[str] = []

    # Update benchmarks
    bm_fields = update_benchmarks(doc, quotes, moment)
    updated_fields.extend(bm_fields)

    chart_fields = update_normalized(doc, history)
    updated_fields.extend(chart_fields)

    if mock_quotes is not None:
        if mock_margin is not None:
            updated_fields.extend(update_margin_buy_share(doc, mock_margin[0], mock_margin[1]))
    else:
        fetched = fetch_margin_inputs(failures)
        if fetched is not None:
            updated_fields.extend(update_margin_buy_share(doc, fetched[0], fetched[1]))

    # Update snapshot
    doc["snapshot"] = snapshot_stamp(moment)
    updated_fields.append("snapshot")

    if dry_run:
        log("INFO", f"dry-run: updated {len(updated_fields)} fields: {', '.join(updated_fields)}")
    else:
        with tempfile.NamedTemporaryFile("w", dir=path.parent, delete=False, encoding="utf-8") as tmp:
            json.dump(doc, tmp, ensure_ascii=False, indent=2)
            tmp.write("\n")
            tmp_path = Path(tmp.name)
        tmp_path.replace(path)
        log("INFO", f"wrote {_display_path(path)} ({len(updated_fields)} fields updated)")

    if failures:
        log("WARN", "series with errors: " + " | ".join(failures))

    return 0


def _display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return path.name


def _assert(cond: bool, message: str) -> None:
    if not cond:
        raise AssertionError(message)


def self_test() -> int:
    log("INFO", "running refresh_tech_semi_data self-test...")
    session = date(2026, 9, 23)
    p_session = date(2026, 9, 22)

    bars_sox = {
        p_session: Bar(p_session, 11000.0, 11300.0, 10900.0, 11246.11, 1000),
        session: Bar(session, 11300.0, 12600.0, 11200.0, 12534.27, 2000),
    }
    sox = Quote("^SOX", 12534.27, 11246.11, 11300.0, 12600.0, 11200.0, session, bars_sox, "test")
    mock_quotes = {"sox": sox}

    history_dates = [session - timedelta(days=i) for i in range(25, -1, -1)]
    sox_hist_bars: dict[date, Bar] = {}
    chip_hist_bars: dict[date, Bar] = {}
    star_hist_bars: dict[date, Bar] = {}
    for i, d in enumerate(history_dates):
        sox_hist_bars[d] = Bar(d, 10000.0 + i * 100, 10000.0 + i * 100, 10000.0 + i * 100, 10000.0 + i * 100, 100)
        chip_hist_bars[d] = Bar(d, 1.0 + i * 0.01, 1.0 + i * 0.01, 1.0 + i * 0.01, 1.0 + i * 0.01, 100)
        star_hist_bars[d] = Bar(d, 1.5 + i * 0.015, 1.5 + i * 0.015, 1.5 + i * 0.015, 1.5 + i * 0.015, 100)

    sox_hist = Quote("^SOX", 12600.0, 12500.0, None, None, None, session, sox_hist_bars, "test")
    chip_hist = Quote("512480.SS", 1.26, 1.25, None, None, None, session, chip_hist_bars, "test")
    star_hist = Quote("588000.SS", 1.89, 1.88, None, None, None, session, star_hist_bars, "test")

    mock_history = {
        "sox": sox_hist,
        "star50": star_hist,
        "chip_etf": chip_hist,
    }

    doc = {
        "snapshot": "2026-09-01 10:00",
        "head": {"title": "科技半导体", "sub": "保留不改的叙述"},
        "signal": {"verdict": "叙述保持"},
        "anomalies": {"note": "保留"},
        "benchmarks": {
            "sox": {"name": "费城半导体", "price": 10000.0, "chg": "+0.00%", "chgClass": ""},
            "nvda": {"name": "英伟达", "price": 1},
            "tsm": {"name": "台积电", "price": 1},
            "ndx": {"name": "纳指", "price": 1},
            "hstech": {"name": "恒生科技", "price": 1},
            "csi300": {"name": "沪深300", "price": 1},
        },
        "charts": {"ratios": {"dates": []}},
        "crowdingProxy": {"score": 1},
        "liquidity": {"usdjpy": {"price": 1}},
        "leverage": {
            "note": "保留说明",
            "marginBuyShare": {"k": "两融买入强度", "metric": "融资买入额 / 成交额", "watch": "保留观察"},
        },
    }

    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as tmp:
        json.dump(doc, tmp, ensure_ascii=False)
        test_file = Path(tmp.name)

    try:
        status = refresh_tech_semi(
            dry_run=False,
            data_path=test_file,
            mock_quotes=mock_quotes,
            mock_history=mock_history,
            mock_margin=(
                [("2026-09-24", 50e8), ("2026-09-23", 100e8)],
                {"2026-09-23": 1000e8},
            ),
        )
        _assert(status == 0, "status 0")

        with open(test_file, "r", encoding="utf-8") as f:
            updated = json.load(f)

        _assert(updated["head"]["sub"] == "保留不改的叙述", "narrative untouched")
        _assert(updated["signal"]["verdict"] == "叙述保持", "signal untouched")
        _assert(updated["anomalies"]["note"] == "保留", "anomalies untouched")
        _assert(updated["benchmarks"]["sox"]["price"] == 12534.27, "sox price updated")
        _assert(updated["benchmarks"]["sox"]["chg"] == "+11.45%", f"sox chg {updated['benchmarks']['sox']['chg']}")
        _assert("nvda" not in updated["benchmarks"], "nvda removed")
        _assert("tsm" not in updated["benchmarks"], "tsm removed")
        _assert("ndx" not in updated["benchmarks"], "ndx removed")
        _assert("hstech" not in updated["benchmarks"], "hstech removed")
        _assert("csi300" not in updated["benchmarks"], "csi300 removed")
        _assert("crowdingProxy" not in updated, "proxy removed")
        _assert("ratios" not in updated["charts"], "ratios removed")
        norm = updated["charts"]["normalized"]
        _assert(len(norm["dates"]) >= 20, "normalized dates")
        _assert(norm["sox"][0] == 0.0 and norm["star50"][0] == 0.0, "normalized base")
        _assert("nvda" not in norm and "tsm" not in norm, "single names off the chart")
        _assert("liquidity" not in updated, "fx and yield removed")
        margin = updated["leverage"]["marginBuyShare"]
        _assert(margin["watch"] == "保留观察", "margin wording kept")
        _assert(margin["asOf"] == "2026-09-23", "margin uses the day with turnover")
        _assert(margin["value"] == 10.0, f"margin share {margin['value']}")
        _assert(margin["v"] == "高于平常", "margin above the ordinary band")
        _assert(updated["leverage"]["note"] == "保留说明", "leverage note kept")
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
        help="Fetch and compute updates but do not write to file.",
    )
    args = parser.parse_args()

    if args.self_test:
        return self_test()

    return refresh_tech_semi(dry_run=args.dry_run)


if __name__ == "__main__":
    sys.exit(main())
