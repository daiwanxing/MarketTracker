#!/usr/bin/env python3
"""Refresh tech semiconductor numeric fields in techSemiData.json.

Follows the same robustness patterns as refresh_market_data.py:
- Actions-owned numeric keys only (benchmarks, charts.normalized, charts.ratios,
  crowdingProxy, snapshot).
- Narrative keys (head, signal, timeline, news, risks, footer, methodology hints)
  are strictly left untouched.
- No null-as-truth; WARN and keep prior value on failure.
- Asia/Shanghai timestamps.

Symbols monitored:
- SOX (^SOX): 费城半导体指数
- NDX (^NDX): 纳斯达克100指数
- TSM (TSM): 台积电 ADR (晶圆代工与先进制程风向标)
- HSTECH: 恒生科技指数 (现价/昨收取自 HSTECH.HK；历史走势用流动性最好的 3033.HK 追踪代理)
- STAR50: 科创50指数 (现价/昨收取自 000688.SS；历史走势用 588000.SS 追踪代理)
- CSI300: 沪深300指数 (现价/昨收取自 000300.SS；历史走势用 510300.SS 追踪代理)
- CHIP_ETF: 中证全指半导体ETF (512480.SS)
"""

from __future__ import annotations

import argparse
import json
import math
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
    "^NDX": (2000.0, 100000.0),
    "TSM": (10.0, 3000.0),
    "HSTECH.HK": (500.0, 30000.0),
    "3033.HK": (0.5, 50.0),
    "000688.SS": (200.0, 10000.0),
    "000300.SS": (500.0, 20000.0),
    "512480.SS": (0.1, 50.0),
    "588000.SS": (0.1, 50.0),
    "510300.SS": (0.5, 50.0),
}


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


def http_json(url: str) -> object:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": UA, "Accept": "application/json,text/plain,*/*"},
    )
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


def compute_crowding_proxy(
    history_by_series: dict[str, list[float]],
    as_of_date: str,
) -> dict:
    """Compute an honest Phase-1 crowding proxy (0-100 score).

    Methodology:
    Derived ONLY from computable public price history (relative strength + realized vol).
    NOT TMT turnover share, margin financing balance, or top-5% stock turnover concentration.
    1. Short-term momentum component (60% weight):
       Average 20-day return across basket mapped to [0, 100] scale.
       Zero return corresponds to 50; +15% maps towards 80; -15% maps towards 20.
    2. Short-term dispersion component (40% weight):
       Cross-sectional standard deviation of 20-day returns.
       Low dispersion (<3%) reflects broad sector convergence/unison (higher trend score),
       High dispersion reflects divergence/fatigue.
    Total score is clipped to [0, 100].
    Zones:
      0..30: 冰点 (Oversold / Cold)
      30..60: 中性 (Neutral)
      60..80: 偏热 (Elevated / Warm)
      80..100: 过热 (Overheated / Hot)
    """
    # 20-day returns
    returns_20d: list[float] = []
    sox_20d_ret: float | None = None

    for key, closes in history_by_series.items():
        if len(closes) >= 21 and closes[-21] > 0:
            ret = (closes[-1] / closes[-21] - 1.0) * 100.0
            returns_20d.append(ret)
            if key == "sox":
                sox_20d_ret = round(ret, 2)

    if not returns_20d:
        return {
            "score": 50,
            "label": "中性",
            "zone": "neutral",
            "asOf": as_of_date,
            "methodNote": "Phase-1 价格动量与截面波动代理指标（非 A 股 TMT 成交占比或融资余额）",
            "cards": {
                "sox20dReturn": None,
                "basket20dReturnMean": None,
                "basket20dDispersion": None,
            },
        }

    mean_ret = sum(returns_20d) / len(returns_20d)
    var = sum((r - mean_ret) ** 2 for r in returns_20d) / len(returns_20d)
    dispersion = math.sqrt(var)

    # Momentum component: 50 + (mean_ret / 15.0) * 30 -> [-15% -> 20, 0% -> 50, +15% -> 80]
    mom_score = 50.0 + (mean_ret / 15.0) * 30.0
    mom_score = max(5.0, min(95.0, mom_score))

    # Dispersion component: high dispersion dampens score if overheated, or lifts if cold
    disp_adj = (5.0 - dispersion) * 2.0  # around 0 for 5% dispersion
    raw_score = 0.7 * mom_score + 0.3 * (50.0 + disp_adj)
    final_score = int(round(max(0.0, min(100.0, raw_score))))

    if final_score < 30:
        label = "冰点"
        zone = "cold"
    elif final_score < 60:
        label = "中性"
        zone = "neutral"
    elif final_score < 80:
        label = "偏热"
        zone = "warm"
    else:
        label = "过热"
        zone = "hot"

    return {
        "score": final_score,
        "label": label,
        "zone": zone,
        "asOf": as_of_date,
        "methodNote": "Phase-1 动量与收益发散度代理指标，非 A 股 TMT 成交占比、融资余额或 top-5% 换手集中度（待 Phase-2 接入）",
        "cards": {
            "sox20dReturn": sox_20d_ret,
            "basket20dReturnMean": round(mean_ret, 2),
            "basket20dDispersion": round(dispersion, 2),
        },
    }


def update_benchmarks(
    doc: dict,
    quotes: dict[str, Quote | None],
    moment: datetime,
) -> list[str]:
    updated_keys: list[str] = []
    benchmarks = doc.setdefault("benchmarks", {})

    series_meta = {
        "sox": ("^SOX", "费城半导体指数", 2),
        "ndx": ("^NDX", "纳斯达克100指数", 2),
        "tsm": ("TSM", "台积电 ADR", 2),
        "hstech": ("HSTECH.HK", "恒生科技指数", 2),
        "star50": ("000688.SS", "科创50指数", 2),
        "csi300": ("000300.SS", "沪深300指数", 2),
        "chip_etf": ("512480.SS", "中证半导体ETF", 3),
    }

    date_str = moment.strftime("%m-%d %H:%M")

    for key, (sym, name, ndigits) in series_meta.items():
        q = quotes.get(key)
        if q is None:
            log("WARN", f"Benchmark {key} ({sym}) unavailable; preserving existing numbers")
            continue

        pct_str, chg_cls = format_change(q.price, q.previous_close)
        benchmarks[key] = {
            "name": name,
            "symbol": sym,
            "price": round(q.price, ndigits),
            "chg": pct_str,
            "chgClass": chg_cls,
            "previousClose": round(q.previous_close, ndigits) if q.previous_close else None,
            "src": f"{sym} {date_str} 上海 · {q.source}",
        }
        updated_keys.append(f"benchmarks.{key}")

    return updated_keys


def update_normalized_and_ratios(
    doc: dict,
    history_quotes: dict[str, Quote | None],
) -> list[str]:
    """Compute 6-month normalized performance (% change from start) and key ratios."""
    updated: list[str] = []

    # Check that anchor quotes exist
    sox_q = history_quotes.get("sox")
    if sox_q is None:
        log("WARN", "SOX history unavailable; normalized chart and ratios preserved")
        return updated

    # Date universe based on SOX trading days
    sox_dates = sorted(sox_q.bars.keys())
    if len(sox_dates) < 20:
        log("WARN", "SOX history too short; normalized chart preserved")
        return updated

    # Use up to last 125 trading sessions (~6 months)
    anchor_dates = sox_dates[-125:]
    date_strs = [d.strftime("%m-%d") for d in anchor_dates]

    # For each series, map each anchor date to closest available close (forward fill)
    series_history_aligned: dict[str, list[float]] = {}
    normalized_series: dict[str, list[float]] = {}

    series_keys = ["sox", "ndx", "tsm", "hstech", "star50", "chip_etf", "csi300"]

    for skey in series_keys:
        q = history_quotes.get(skey)
        if q is None or not q.bars:
            continue
        sorted_days = sorted(q.bars.keys())
        aligned_closes: list[float] = []
        last_close = q.bars[sorted_days[0]].close or q.price
        idx = 0
        for ad in anchor_dates:
            while idx < len(sorted_days) and sorted_days[idx] <= ad:
                c = q.bars[sorted_days[idx]].close
                if c is not None:
                    last_close = c
                idx += 1
            aligned_closes.append(last_close)

        series_history_aligned[skey] = aligned_closes

        base_val = aligned_closes[0]
        if base_val > 0:
            norm = [round(((val / base_val) - 1.0) * 100.0, 2) for val in aligned_closes]
            normalized_series[skey] = norm

    charts = doc.setdefault("charts", {})
    charts["normalized"] = {
        "dates": date_strs,
        "sox": normalized_series.get("sox", []),
        "ndx": normalized_series.get("ndx", []),
        "tsm": normalized_series.get("tsm", []),
        "hstech": normalized_series.get("hstech", []),
        "star50": normalized_series.get("star50", []),
        "chip_etf": normalized_series.get("chip_etf", []),
    }
    updated.append("charts.normalized")

    # Ratio 1: star50_csi300 (科创50相对沪深300比值)
    star_closes = series_history_aligned.get("star50")
    csi_closes = series_history_aligned.get("csi300")
    ratio_star_csi: list[float] = []
    if star_closes and csi_closes and len(star_closes) == len(csi_closes):
        for s, c in zip(star_closes, csi_closes):
            ratio_star_csi.append(round(s / c, 4) if c > 0 else 0.0)

    # Ratio 2: chip_sox or star50_sox (国内芯片/科创相对SOX比值)
    chip_closes = series_history_aligned.get("chip_etf")
    sox_closes = series_history_aligned.get("sox")
    ratio_chip_sox: list[float] = []
    if chip_closes and sox_closes and len(chip_closes) == len(sox_closes):
        for ch, sx in zip(chip_closes, sox_closes):
            ratio_chip_sox.append(round((ch / sx) * 10000.0, 3) if sx > 0 else 0.0)

    charts["ratios"] = {
        "dates": date_strs,
        "star50_csi300": {
            "series": ratio_star_csi,
            "latest": ratio_star_csi[-1] if ratio_star_csi else None,
            "name": "科创50 / 沪深300 相对强弱",
            "hint": "反映硬科技相对大盘权重的强弱分化趋势",
        },
        "chip_sox": {
            "series": ratio_chip_sox,
            "latest": ratio_chip_sox[-1] if ratio_chip_sox else None,
            "name": "中证芯片 / 费城半导体 比值 (×10⁴)",
            "hint": "反映国内芯片资产相对全球半导体基准的相对溢价/折价走向",
        },
    }
    updated.append("charts.ratios")

    # Crowding proxy calculation (legacy Phase-1 kept for backward compatibility if needed)
    # Note: Phase-2 A-share TMT crowding metrics are managed independently by scripts/refresh_tech_semi_crowding.py
    if "crowding" not in doc:
        as_of = anchor_dates[-1].strftime("%Y-%m-%d")
        crowding = compute_crowding_proxy(series_history_aligned, as_of)
        doc["crowdingProxy"] = crowding
        updated.append("crowdingProxy")

    return updated


def refresh_tech_semi(
    dry_run: bool = False,
    data_path: Path | None = None,
    mock_quotes: dict[str, Quote | None] | None = None,
    mock_history: dict[str, Quote | None] | None = None,
) -> int:
    path = TECH_SEMI_PATH if data_path is None else data_path
    moment = shanghai_now()
    log("INFO", f"tech semi refresh started at {snapshot_stamp(moment)} Asia/Shanghai")

    failures: list[str] = []

    if mock_quotes is not None and mock_history is not None:
        quotes = mock_quotes
        history = mock_history
    else:
        # Fetch current quotes for benchmarks using 5d window for accurate 1-day previous close
        sox_q = try_fetch("^SOX", failures, "5d")
        ndx_q = try_fetch("^NDX", failures, "5d")
        tsm_q = try_fetch("TSM", failures, "5d")
        hstech_q = try_fetch("HSTECH.HK", failures, "5d")
        star50_q = try_fetch("000688.SS", failures, "5d")
        csi300_q = try_fetch("000300.SS", failures, "5d")
        chip_etf_q = try_fetch("512480.SS", failures, "5d")

        # Fetch tracking proxies with full 6mo history for charts and crowding metrics
        sox_hist = try_fetch("^SOX", failures, "6mo")
        ndx_hist = try_fetch("^NDX", failures, "6mo")
        tsm_hist = try_fetch("TSM", failures, "6mo")
        hstech_proxy = try_fetch("3033.HK", failures, "6mo")
        star50_proxy = try_fetch("588000.SS", failures, "6mo")
        csi300_proxy = try_fetch("510300.SS", failures, "6mo")
        chip_etf_hist = try_fetch("512480.SS", failures, "6mo")

        quotes = {
            "sox": sox_q,
            "ndx": ndx_q,
            "tsm": tsm_q,
            "hstech": hstech_q or hstech_proxy,
            "star50": star50_q or star50_proxy,
            "csi300": csi300_q or csi300_proxy,
            "chip_etf": chip_etf_q,
        }

        history = {
            "sox": sox_hist or sox_q,
            "ndx": ndx_hist or ndx_q,
            "tsm": tsm_hist or tsm_q,
            "hstech": hstech_proxy or hstech_q,
            "star50": star50_proxy or star50_q,
            "csi300": csi300_proxy or csi300_q,
            "chip_etf": chip_etf_hist or chip_etf_q,
        }

    # If primary benchmark (SOX) completely failed, do not overwrite snapshot as truth
    if quotes.get("sox") is None and quotes.get("tsm") is None:
        log("ERROR", "total failure: both SOX and TSM primary quotes failed")
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

    # Update normalized charts, ratios, crowdingProxy
    chart_fields = update_normalized_and_ratios(doc, history)
    updated_fields.extend(chart_fields)

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

    bars_tsm = {
        p_session: Bar(p_session, 410.0, 420.0, 405.0, 417.72, 1000),
        session: Bar(session, 420.0, 450.0, 418.0, 446.57, 2000),
    }
    tsm = Quote("TSM", 446.57, 417.72, 420.0, 450.0, 418.0, session, bars_tsm, "test")

    mock_quotes = {"sox": sox, "tsm": tsm}

    # 30 days history for normalized calculation test
    history_dates = [session - timedelta(days=i) for i in range(25, -1, -1)]
    sox_hist_bars = {}
    chip_hist_bars = {}
    csi_hist_bars = {}
    star_hist_bars = {}

    for i, d in enumerate(history_dates):
        sox_hist_bars[d] = Bar(d, 10000.0 + i * 100, 10000.0 + i * 100, 10000.0 + i * 100, 10000.0 + i * 100, 100)
        chip_hist_bars[d] = Bar(d, 1.0 + i * 0.01, 1.0 + i * 0.01, 1.0 + i * 0.01, 1.0 + i * 0.01, 100)
        csi_hist_bars[d] = Bar(d, 4000.0 + i * 20, 4000.0 + i * 20, 4000.0 + i * 20, 4000.0 + i * 20, 100)
        star_hist_bars[d] = Bar(d, 1.5 + i * 0.015, 1.5 + i * 0.015, 1.5 + i * 0.015, 1.5 + i * 0.015, 100)

    sox_hist = Quote("^SOX", 12600.0, 12500.0, None, None, None, session, sox_hist_bars, "test")
    chip_hist = Quote("512480.SS", 1.26, 1.25, None, None, None, session, chip_hist_bars, "test")
    csi_hist = Quote("510300.SS", 4520.0, 4500.0, None, None, None, session, csi_hist_bars, "test")
    star_hist = Quote("588000.SS", 1.89, 1.88, None, None, None, session, star_hist_bars, "test")

    mock_history = {
        "sox": sox_hist,
        "ndx": sox_hist,
        "tsm": sox_hist,
        "hstech": chip_hist,
        "star50": star_hist,
        "csi300": csi_hist,
        "chip_etf": chip_hist,
    }

    doc = {
        "snapshot": "2026-09-01 10:00",
        "head": {"title": "科技半导体", "sub": "保留不改的叙述"},
        "signal": {"verdict": "叙述保持"},
        "benchmarks": {
            "sox": {"name": "费城半导体", "price": 10000.0, "chg": "+0.00%", "chgClass": ""},
            "tsm": {"name": "台积电", "price": 400.0, "chg": "+0.00%", "chgClass": ""},
        },
        "charts": {},
        "crowdingProxy": {},
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
        )
        _assert(status == 0, "status 0")

        with open(test_file, "r", encoding="utf-8") as f:
            updated = json.load(f)

        _assert(updated["head"]["sub"] == "保留不改的叙述", "narrative untouched")
        _assert(updated["signal"]["verdict"] == "叙述保持", "signal untouched")
        _assert(updated["benchmarks"]["sox"]["price"] == 12534.27, "sox price updated")
        _assert(updated["benchmarks"]["sox"]["chg"] == "+11.45%", f"sox chg {updated['benchmarks']['sox']['chg']}")
        _assert(updated["benchmarks"]["sox"]["chgClass"] == "up", "sox chgClass")
        _assert(len(updated["charts"]["normalized"]["dates"]) > 0, "normalized dates populated")
        _assert("star50_csi300" in updated["charts"]["ratios"], "ratios populated")
        _assert("chip_sox" in updated["charts"]["ratios"], "chip_sox ratio populated")
        _assert(0 <= updated["crowdingProxy"]["score"] <= 100, "crowding proxy score 0-100")
        _assert("Phase-1" in updated["crowdingProxy"]["methodNote"], "honest methodNote")
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
