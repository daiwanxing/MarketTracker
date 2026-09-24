#!/usr/bin/env python3
"""Refresh oil and gold numeric fields in the MarketTracker JSON snapshots.

Narrative blocks (news, timeline, signal prose, ENSO) are left untouched.
Snapshot timestamps are written in Asia/Shanghai.

Public sources that respond without an API key (Stooq's old CSV path
``/q/l/`` currently returns 404, so it is not used):

* Yahoo Finance chart API, tried on ``query1`` then ``query2``:
  ``https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval=1d&range=6mo``
  - ``BZ=F`` ICE Brent futures (oil headline)
  - ``CL=F`` NYMEX WTI futures
  - ``DX-Y.NYB`` ICE US Dollar Index
  - ``GC=F`` COMEX gold futures
  - ``^TNX`` CBOE 10-year Treasury yield (quoted in percent)
* Spot gold XAU/USD:
  - https://api.gold-api.com/price/XAU
  - fallback: Swissquote public BBO mid
    https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/XAU/USD

Exit status is 0 when at least one of the oil or gold files is updated.
Exit status is 1 when both primary quotes fail (total failure). A series
that fails is logged and skipped; the rest are still written.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
OIL_PATH = ROOT / "src" / "data" / "oilData.json"
GOLD_PATH = ROOT / "src" / "data" / "goldData.json"

SHANGHAI = ZoneInfo("Asia/Shanghai")
YAHOO_HOSTS = ("query1.finance.yahoo.com", "query2.finance.yahoo.com")
UA = "Mozilla/5.0 (compatible; MarketTrackerRefresh/1.0; +https://github.com/daiwanxing/MarketTracker)"

# Absolute sanity windows. A print outside these is treated as a failed fetch.
RANGES = {
    "BZ=F": (20.0, 250.0),
    "CL=F": (20.0, 250.0),
    "DX-Y.NYB": (50.0, 200.0),
    "GC=F": (500.0, 20000.0),
    "^TNX": (0.0, 25.0),
    "XAU": (500.0, 20000.0),
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

    @property
    def volume(self) -> float | None:
        bar = self.bars.get(self.session)
        return bar.volume if bar else None


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
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number:  # NaN
        return None
    return number


def _in_range(symbol: str, price: float) -> bool:
    lo, hi = RANGES[symbol]
    return lo <= price <= hi


def next_weekday(day: date) -> date:
    nxt = day + timedelta(days=1)
    while nxt.weekday() >= 5:
        nxt += timedelta(days=1)
    return nxt


def bars_from_yahoo(result: dict) -> tuple[dict[date, Bar], date, float]:
    """Split settled daily candles from Yahoo's later live print.

    Futures history uses one timestamp per session (local midnight). After that
    candle has a close, a second timestamp on the same calendar date is the
    next session — the evening reopen — not a rewrite of the settled high/low.
    While the candle close is still null, the live print belongs to that session.
    """
    meta = result["meta"]
    tz = ZoneInfo(meta.get("exchangeTimezoneName") or "America/New_York")
    quote = result["indicators"]["quote"][0]
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
    day_high = _num(meta.get("regularMarketDayHigh"))
    day_low = _num(meta.get("regularMarketDayLow"))
    live_volume = _num(meta.get("regularMarketVolume"))
    rows_today = grouped.get(live_date, [])
    official_today = official.get(live_date)
    overlay = rows_today[-1] if len(rows_today) >= 2 else None
    rolled = (
        overlay is not None
        and official_today is not None
        and official_today.close is not None
        and overlay[0] > rows_today[0][0]
    )

    def apply_live_range(
        opened: float | None,
        high: float | None,
        low: float | None,
        volume: float | None,
    ) -> tuple[float | None, float | None, float | None, float | None]:
        if day_high is not None:
            high = day_high if high is None else max(high, day_high)
        if day_low is not None:
            low = day_low if low is None else min(low, day_low)
        if live_volume is not None:
            volume = live_volume
        return opened, high, low, volume

    bars: dict[date, Bar] = {
        day: bar for day, bar in official.items() if bar.close is not None and day != live_date
    }
    if rolled and official_today is not None and overlay is not None:
        session = next_weekday(live_date)
        bars[live_date] = official_today
        _moment, opened, high, low, _close, volume = overlay
        opened, high, low, volume = apply_live_range(opened, high, low, volume)
        bars[session] = Bar(session, opened, high, low, price, volume)
    else:
        session = live_date
        opened = official_today.open if official_today else None
        high = official_today.high if official_today else None
        low = official_today.low if official_today else None
        volume = official_today.volume if official_today else None
        if overlay is not None:
            _moment, o2, h2, l2, _close, v2 = overlay
            if opened is None:
                opened = o2
            if h2 is not None:
                high = h2 if high is None else max(high, h2)
            if l2 is not None:
                low = l2 if low is None else min(low, l2)
            if v2 is not None:
                volume = v2
        opened, high, low, volume = apply_live_range(opened, high, low, volume)
        bars[session] = Bar(session, opened, high, low, price, volume)
    return bars, session, price


def previous_close(bars: dict[date, Bar], session: date) -> float | None:
    earlier = [day for day in bars if day < session and bars[day].close is not None]
    if not earlier:
        return None
    return bars[max(earlier)].close


def fetch_yahoo(symbol: str) -> Quote:
    encoded = urllib.parse.quote(symbol, safe="")
    errors: list[str] = []
    for host in YAHOO_HOSTS:
        url = f"https://{host}/v8/finance/chart/{encoded}?interval=1d&range=6mo"
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
        try:
            bars, session, price = bars_from_yahoo(result[0])
        except (KeyError, TypeError, ValueError) as exc:
            errors.append(f"{host}: {exc}")
            continue
        if not _in_range(symbol, price):
            errors.append(f"{host}: price {price} outside expected range")
            continue
        bar = bars.get(session)
        log("INFO", f"fetched {symbol} {price} session {session.isoformat()} via {url}")
        return Quote(
            symbol=symbol,
            price=price,
            previous_close=previous_close(bars, session),
            open=bar.open if bar else None,
            high=bar.high if bar else None,
            low=bar.low if bar else None,
            session=session,
            bars=bars,
            source=url,
        )
    raise RuntimeError(f"{symbol} failed ({'; '.join(errors)})")


def fetch_spot_gold() -> tuple[float, str]:
    errors: list[str] = []
    url = "https://api.gold-api.com/price/XAU"
    try:
        payload = http_json(url)
        price = _num(payload.get("price") if isinstance(payload, dict) else None)
        if price is not None and _in_range("XAU", price):
            log("INFO", f"fetched XAU/USD {price} via {url}")
            return price, url
        errors.append(f"gold-api price {price}")
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError, AttributeError) as exc:
        errors.append(f"gold-api: {exc}")

    url = "https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/XAU/USD"
    try:
        payload = http_json(url)
        venues = payload if isinstance(payload, list) else []
        for venue in venues:
            profiles = venue.get("spreadProfilePrices") if isinstance(venue, dict) else None
            if not profiles:
                continue
            bid = _num(profiles[0].get("bid"))
            ask = _num(profiles[0].get("ask"))
            if bid is None or ask is None or ask < bid:
                continue
            mid = (bid + ask) / 2
            if _in_range("XAU", mid):
                log("INFO", f"fetched XAU/USD {mid:.2f} via {url}")
                return mid, url
        errors.append("swissquote: no usable bid/ask")
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError, AttributeError, IndexError) as exc:
        errors.append(f"swissquote: {exc}")
    raise RuntimeError(f"XAU/USD failed ({'; '.join(errors)})")


def try_fetch_yahoo(symbol: str, failures: list[str]) -> Quote | None:
    try:
        return fetch_yahoo(symbol)
    except Exception as exc:  # noqa: BLE001 - one series must not abort the run
        failures.append(f"{symbol}: {exc}")
        log("WARN", f"{symbol} unavailable: {exc}")
        return None


def change_parts(price: float, previous: float | None) -> tuple[str, str] | None:
    if previous is None or previous == 0:
        return None
    pct = (price - previous) / previous * 100.0
    if abs(pct) < 0.005:
        return "0.00%", "flat"
    if pct > 0:
        return f"+{pct:.2f}%", "up"
    return f"{pct:.2f}%", "down"


def shanghai_now() -> datetime:
    return datetime.now(SHANGHAI)


def snapshot_stamp(moment: datetime) -> str:
    return moment.strftime("%Y-%m-%d %H:%M")


def clock_stamp(moment: datetime) -> str:
    return f"{moment.month}-{moment.day} {moment.hour:02d}:{moment.minute:02d} 上海"


def source_label(url: str) -> str:
    host = url.split("//", 1)[-1].split("/")[0]
    if "gold-api.com" in host:
        return "gold-api.com"
    if "swissquote.com" in host:
        return "Swissquote"
    if "yahoo" in host:
        return "Yahoo Finance"
    return host


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: dict) -> None:
    text = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)


def anchor_label(label: str, not_after: date) -> date:
    month, day = (int(part) for part in label.split("-"))
    cand = date(not_after.year, month, day)
    if cand > not_after:
        cand = date(not_after.year - 1, month, day)
    return cand


def parse_mmdd_labels(labels: list[str], not_after: date) -> list[date]:
    """Map chart labels like ``09-22`` onto real dates, walking backward across New Year."""
    if not labels:
        return []
    parsed: list[date] = [anchor_label(labels[-1], not_after)]
    for label in reversed(labels[:-1]):
        month, day = (int(part) for part in label.split("-"))
        year = parsed[0].year
        cand = date(year, month, day)
        if cand >= parsed[0]:
            cand = date(year - 1, month, day)
        parsed.insert(0, cand)
    return parsed


def previous_weekday(day: date) -> date:
    prev = day - timedelta(days=1)
    while prev.weekday() >= 5:
        prev -= timedelta(days=1)
    return prev


def replace_labeled_number(text: str, label: str, rendered: str) -> str:
    pattern = rf"({re.escape(label)}\s*)(-?\d+(?:\.\d+)?)"
    updated, count = re.subn(pattern, rf"\g<1>{rendered}", text, count=1)
    if count:
        return updated
    piece = f"{label} {rendered}"
    stripped = text.strip()
    return f"{stripped} · {piece}" if stripped else piece


def series_high(values: list[object], fallback: object) -> object:
    nums = [float(v) for v in values if isinstance(v, (int, float))]
    if not nums:
        return fallback
    return round(max(nums), 2)


def update_oil_chart(charts: dict, wti: Quote | None, brent: Quote | None, session: date) -> int:
    dates: list[str] = charts["dates"]
    wti_series: list[object] = charts["wti"]
    brent_series: list[object] = charts["brent"]
    sc_series: list[object] = charts["sc"]
    if not (len(dates) == len(wti_series) == len(brent_series) == len(sc_series)):
        raise ValueError(
            "oil chart lengths differ: "
            f"dates={len(dates)} wti={len(wti_series)} brent={len(brent_series)} sc={len(sc_series)}"
        )
    parsed = parse_mmdd_labels(dates, session)
    written = 0

    def close_for(quote: Quote | None, day: date) -> float | None:
        if quote is None:
            return None
        bar = quote.bars.get(day)
        if bar is None or bar.close is None:
            return None
        return round(bar.close, 2)

    for i, day in enumerate(parsed):
        if day > session:
            continue
        if day < session:
            if wti_series[i] is None:
                value = close_for(wti, day)
                if value is not None:
                    wti_series[i] = value
                    written += 1
            if brent_series[i] is None:
                value = close_for(brent, day)
                if value is not None:
                    brent_series[i] = value
                    written += 1
            continue
        # Current session is still printing; keep the chart point on the live price.
        value = close_for(wti, day)
        if value is not None and wti_series[i] != value:
            wti_series[i] = value
            written += 1
        value = close_for(brent, day)
        if value is not None and brent_series[i] != value:
            brent_series[i] = value
            written += 1

    last = parsed[-1] if parsed else date.min
    extra_days = set()
    if wti is not None:
        extra_days.update(wti.bars)
    if brent is not None:
        extra_days.update(brent.bars)
    for day in sorted(extra_days):
        if day <= last or day > session:
            continue
        wti_close = close_for(wti, day)
        brent_close = close_for(brent, day)
        if wti_close is None and brent_close is None:
            continue
        dates.append(f"{day.month:02d}-{day.day:02d}")
        wti_series.append(wti_close)
        brent_series.append(brent_close)
        sc_series.append(None)
        written += 1
        last = day

    charts["wtiHigh"] = series_high(wti_series, charts.get("wtiHigh"))
    charts["brentHigh"] = series_high(brent_series, charts.get("brentHigh"))
    return written


def oil_src(moment: datetime, quote: Quote, chg: str | None) -> str:
    bits = [f"BZ=F 布伦特原油期货 {clock_stamp(moment)}"]
    if quote.previous_close is not None:
        bits.append(f"昨收 {quote.previous_close:.2f}")
    detail = [f"现价 {quote.price:.2f}{('/' + chg) if chg else ''}"]
    if quote.open is not None:
        detail.append(f"今开 {quote.open:.2f}")
    if quote.high is not None:
        detail.append(f"高 {quote.high:.2f}")
    if quote.low is not None:
        detail.append(f"低 {quote.low:.2f}")
    if len(detail) == 1:
        parenthetical = f"（{detail[0]}）"
    else:
        parenthetical = f"（{detail[0]}，{' / '.join(detail[1:])}）"
    return " · ".join(bits) + parenthetical + " · Yahoo Finance"


def update_oil(data: dict, brent: Quote, wti: Quote | None, dxy: Quote | None, moment: datetime) -> list[str]:
    updated = ["snapshot", "metrics.main.num"]
    data["snapshot"] = snapshot_stamp(moment)
    main = data["metrics"]["main"]
    main["num"] = f"{brent.price:.2f}"
    chg = change_parts(brent.price, brent.previous_close)
    chg_text = chg[0] if chg else None
    if chg is not None:
        main["chg"] = chg[0]
        main["chgClass"] = chg[1]
        updated += ["metrics.main.chg", "metrics.main.chgClass"]
    else:
        log("WARN", "oil change left unchanged; Brent previous close missing")
    main["src"] = oil_src(moment, brent, chg_text)
    updated.append("metrics.main.src")
    refs = main.get("refs") or ""
    if wti is not None:
        refs = replace_labeled_number(refs, "WTI", f"{wti.price:.2f}")
        updated.append("metrics.main.refs.WTI")
    if dxy is not None:
        refs = replace_labeled_number(refs, "DXY", f"{dxy.price:.2f}")
        updated.append("metrics.main.refs.DXY")
    main["refs"] = refs
    session = brent.session
    if wti is not None:
        session = max(session, wti.session)
    try:
        points = update_oil_chart(data["charts"], wti, brent, session)
        updated.append(f"charts.daily_points={points}")
    except ValueError as exc:
        log("WARN", f"oil chart skipped: {exc}")
    return updated


def update_gold_candles(tech: dict, price: float, session: date, volume: float | None) -> str:
    candles: list[dict] = tech["candles"]
    volumes: list[object] = tech["volume"]
    if len(candles) != len(volumes):
        raise ValueError(f"gold candle/volume length mismatch ({len(candles)} vs {len(volumes)})")
    if not candles:
        raise ValueError("gold candles empty")
    parsed = parse_mmdd_labels([c["d"] for c in candles], session)
    rounded = round(price, 2)
    if parsed[-1] == session:
        candle = candles[-1]
        candle["c"] = rounded
        candle["h"] = round(max(float(candle["h"]), rounded), 2)
        candle["l"] = round(min(float(candle["l"]), rounded), 2)
        return "updated-today"
    if parsed[-1] > session:
        return "skipped-future-candle"
    candles.append(
        {
            "d": f"{session.month:02d}-{session.day:02d}",
            "o": rounded,
            "h": rounded,
            "l": rounded,
            "c": rounded,
        }
    )
    if volume is not None and volume > 0:
        volumes.append(int(round(volume)))
        log("INFO", "appended gold candle volume from COMEX GC=F (spot volume is not published)")
    else:
        volumes.append(volumes[-1] if volumes else 0)
        log("WARN", "COMEX volume missing; carried forward the previous gold volume so the chart stays aligned")
    return "appended"


def update_momentum(tech: dict, chg_text: str | None) -> None:
    closes = [float(c["c"]) for c in tech["candles"]]

    def span(sessions: int) -> str | None:
        if len(closes) <= sessions:
            return None
        start, end = closes[-(sessions + 1)], closes[-1]
        if start == 0:
            return None
        pct = (end - start) / start * 100.0
        return f"{pct:+.1f}%（{start:.0f} → {end:.0f}）"

    for item in tech.get("momentum") or []:
        key = item.get("k")
        if key == "近 20 交易日":
            text = span(20)
            if text:
                item["v"] = text
        elif key == "近 5 交易日":
            text = span(5)
            if text:
                item["v"] = text
        elif key == "今日盘中" and chg_text:
            item["v"] = f"{chg_text}（盘中）"


def replace_macro_prefix(text: str, prefix: str) -> str | None:
    updated, count = re.subn(r"^\d+(?:\.\d+)?%?（[^）]*）", prefix, text, count=1)
    if count:
        return updated
    return None


def update_gold(
    data: dict,
    spot: float,
    spot_source: str,
    comex: Quote | None,
    dxy: Quote | None,
    yield_quote: Quote | None,
    moment: datetime,
) -> list[str]:
    updated = ["snapshot", "metrics.main.num"]
    data["snapshot"] = snapshot_stamp(moment)
    main = data["metrics"]["main"]
    session = comex.session if comex is not None else moment.astimezone(ZoneInfo("America/New_York")).date()
    prev_price = None
    prev_is_prior_session = False
    candles = data["tech"]["candles"]
    if candles:
        parsed = parse_mmdd_labels([c["d"] for c in candles], session)
        earlier = [(day, candles[i]["c"]) for i, day in enumerate(parsed) if day < session]
        if earlier:
            prev_day, prev_price = earlier[-1]
            prev_price = float(prev_price)
            prev_is_prior_session = prev_day == previous_weekday(session)
    chg = change_parts(spot, prev_price)
    chg_text = chg[0] if chg else None
    main["num"] = f"{spot:.2f}"
    if chg is not None:
        main["chg"] = chg[0]
        main["chgClass"] = chg[1]
        updated += ["metrics.main.chg", "metrics.main.chgClass"]
    else:
        log("WARN", "gold change left unchanged; no earlier spot candle to diff against")
    prev_label = "昨收" if prev_is_prior_session else "前次"
    src = f"XAU/USD 伦敦金现货 {clock_stamp(moment)}"
    if prev_price is not None:
        src += f" · {prev_label} {prev_price:.2f}"
    src += f"（现价 {spot:.2f}{('/' + chg_text) if chg_text else ''}） · {source_label(spot_source)}"
    main["src"] = src
    updated.append("metrics.main.src")

    refs = main.get("refs") or ""
    if comex is not None:
        refs = replace_labeled_number(refs, "GC", f"{comex.price:.1f}")
        updated.append("metrics.main.refs.GC")
    if dxy is not None:
        refs = replace_labeled_number(refs, "DXY", f"{dxy.price:.2f}")
        updated.append("metrics.main.refs.DXY")
    main["refs"] = refs

    try:
        action = update_gold_candles(
            data["tech"],
            spot,
            session,
            comex.volume if comex is not None else None,
        )
        if action.startswith("skipped"):
            log("WARN", f"gold candle not moved: {action}")
        updated.append(f"tech.candles={action}")
    except ValueError as exc:
        log("WARN", f"gold candles skipped: {exc}")
    update_momentum(data["tech"], chg_text)
    updated.append("tech.momentum")

    data["sentiment"]["riskReward"]["price"] = round(spot, 2)
    updated.append("sentiment.riskReward.price")

    if comex is not None:
        basis = comex.price - spot
        if abs(basis) <= 200:
            rendered = f"{basis:+.1f} 美元（{moment.month}/{moment.day}）"
            for row in data["positioning"]["table"]:
                if str(row.get("k", "")).startswith("期现基差"):
                    row["v"] = rendered
                    updated.append("positioning.basis")
                    break
        else:
            log("WARN", f"skipped gold basis {basis:.1f}; outside ±200")

    for item in data["macro"]["items"]:
        key = item.get("k")
        if key == "美元指数" and dxy is not None:
            dxy_chg = change_parts(dxy.price, dxy.previous_close)
            if dxy_chg is None:
                log("WARN", "DXY macro text left unchanged; previous close missing")
                continue
            prefix = f"{dxy.price:.2f}（{dxy_chg[0]}）"
            replaced = replace_macro_prefix(str(item.get("v", "")), prefix)
            if replaced is None:
                log("WARN", "DXY macro text did not match the numeric prefix; left unchanged")
            else:
                item["v"] = replaced
                updated.append("macro.dxy")
        elif key == "美债 10 年期收益率" and yield_quote is not None:
            prev = yield_quote.previous_close
            if prev is None:
                log("WARN", "yield macro text left unchanged; previous close missing")
                continue
            bp = (yield_quote.price - prev) * 100.0
            prefix = (
                f"{yield_quote.price:.3f}%"
                f"（{yield_quote.session.month}/{yield_quote.session.day} 收，{bp:+.1f}BP）"
            )
            replaced = replace_macro_prefix(str(item.get("v", "")), prefix)
            if replaced is None:
                log("WARN", "yield macro text did not match the numeric prefix; left unchanged")
            else:
                item["v"] = replaced
                updated.append("macro.yield")
    return updated


def refresh(dry_run: bool = False) -> int:
    failures: list[str] = []
    moment = shanghai_now()
    log("INFO", f"refresh started at {snapshot_stamp(moment)} Asia/Shanghai")

    brent = try_fetch_yahoo("BZ=F", failures)
    wti = try_fetch_yahoo("CL=F", failures)
    dxy = try_fetch_yahoo("DX-Y.NYB", failures)
    comex = try_fetch_yahoo("GC=F", failures)
    yield_quote = try_fetch_yahoo("^TNX", failures)
    spot: float | None = None
    spot_source = ""
    try:
        spot, spot_source = fetch_spot_gold()
    except Exception as exc:  # noqa: BLE001
        failures.append(f"XAU: {exc}")
        log("WARN", f"XAU/USD unavailable: {exc}")

    wrote = False
    if brent is None:
        log("WARN", "oil file left untouched because Brent (BZ=F) failed")
    else:
        oil = load_json(OIL_PATH)
        fields = update_oil(oil, brent, wti, dxy, moment)
        log("INFO", f"oil snapshot {oil['snapshot']} num {oil['metrics']['main']['num']} {oil['metrics']['main']['chg']}")
        log("INFO", "oil fields: " + ", ".join(fields))
        if dry_run:
            log("INFO", "dry-run: oilData.json not written")
        else:
            write_json(OIL_PATH, oil)
            log("INFO", f"wrote {OIL_PATH.relative_to(ROOT)}")
        wrote = True

    if spot is None:
        log("WARN", "gold file left untouched because XAU/USD failed")
    else:
        gold = load_json(GOLD_PATH)
        fields = update_gold(gold, spot, spot_source, comex, dxy, yield_quote, moment)
        log("INFO", f"gold snapshot {gold['snapshot']} num {gold['metrics']['main']['num']} {gold['metrics']['main']['chg']}")
        log("INFO", "gold fields: " + ", ".join(fields))
        if dry_run:
            log("INFO", "dry-run: goldData.json not written")
        else:
            write_json(GOLD_PATH, gold)
            log("INFO", f"wrote {GOLD_PATH.relative_to(ROOT)}")
        wrote = True

    if failures:
        log("WARN", "series with errors: " + " | ".join(failures))
    if not wrote:
        log("ERROR", "total failure: neither oil nor gold primary quote could be updated")
        return 1
    log("INFO", "refresh finished")
    return 0


def _assert(cond: bool, message: str) -> None:
    if not cond:
        raise AssertionError(message)


def self_test() -> int:
    labels = parse_mmdd_labels(["12-30", "12-31", "01-02"], date(2026, 1, 5))
    _assert(labels == [date(2025, 12, 30), date(2025, 12, 31), date(2026, 1, 2)], f"labels {labels}")

    session = date(2026, 9, 23)
    bars = {
        date(2026, 9, 22): Bar(date(2026, 9, 22), 99.0, 100.0, 98.0, 99.25, 10),
        date(2026, 9, 23): Bar(session, 98.2, 98.3, 97.1, 97.73, 12),
    }
    brent = Quote("BZ=F", 97.73, 99.25, 98.2, 98.3, 97.1, session, bars, "test")
    wti = Quote(
        "CL=F",
        91.83,
        94.59,
        92.0,
        92.5,
        91.2,
        session,
        {
            date(2026, 9, 22): Bar(date(2026, 9, 22), 95.0, 96.0, 94.0, 94.59, 10),
            session: Bar(session, 92.0, 92.5, 91.2, 91.83, 11),
        },
        "test",
    )
    charts = {
        "dates": ["09-21", "09-22"],
        "wti": [91.97, None],
        "brent": [95.99, None],
        "sc": [722.5, 717.1],
        "wtiHigh": 105.48,
        "brentHigh": 109.29,
    }
    written = update_oil_chart(charts, wti, brent, session)
    _assert(charts["dates"] == ["09-21", "09-22", "09-23"], f"dates {charts['dates']}")
    _assert(charts["brent"][1] == 99.25 and charts["brent"][2] == 97.73, f"brent {charts['brent']}")
    _assert(charts["wti"][1] == 94.59 and charts["wti"][2] == 91.83, f"wti {charts['wti']}")
    _assert(charts["sc"] == [722.5, 717.1, None], f"sc {charts['sc']}")
    _assert(charts["wtiHigh"] == 94.59 and charts["brentHigh"] == 99.25, f"highs {charts['wtiHigh']} {charts['brentHigh']}")
    _assert(written > 0, "written")
    # Second pass updates the live session in place.
    brent.bars[session] = Bar(session, 98.2, 98.4, 97.0, 97.10, 13)
    update_oil_chart(charts, wti, brent, session)
    _assert(charts["dates"] == ["09-21", "09-22", "09-23"], "no duplicate date")
    _assert(charts["brent"][-1] == 97.10, f"live brent {charts['brent'][-1]}")
    _assert(charts["brent"][1] == 99.25, "past close preserved")

    chg = change_parts(97.73, 99.25)
    _assert(chg == ("-1.53%", "down"), f"chg {chg}")
    _assert(change_parts(100.0, 100.0) == ("0.00%", "flat"), "flat")
    _assert(replace_labeled_number("WTI 90.10 · DXY 100.19", "DXY", "101.13") == "WTI 90.10 · DXY 101.13", "refs")

    tech = {
        "candles": [{"d": "09-22", "o": 4369.0, "h": 4375.0, "l": 4291.0, "c": 4318.18}],
        "volume": [100000],
        "momentum": [
            {"k": "近 20 交易日", "v": "old"},
            {"k": "近 5 交易日", "v": "old"},
            {"k": "今日盘中", "v": "-1.15%（亚欧盘回落）"},
        ],
    }
    # Not enough history for 5/20 day spans; those stay put. Today's percent updates.
    _assert(update_gold_candles(tech, 4278.4, session, 17180) == "appended", "append")
    _assert(tech["candles"][-1]["c"] == 4278.4, "spot close")
    _assert(len(tech["volume"]) == 2 and tech["volume"][-1] == 17180, "volume")
    update_momentum(tech, "-0.92%")
    _assert(tech["momentum"][2]["v"] == "-0.92%（盘中）", tech["momentum"][2]["v"])
    _assert(tech["momentum"][0]["v"] == "old", "short history kept")
    _assert(update_gold_candles(tech, 4280.0, session, 17180) == "updated-today", "same session")
    _assert(tech["candles"][-1]["c"] == 4280.0 and tech["candles"][-1]["o"] == 4278.4, "open preserved")
    _assert(len(tech["candles"]) == len(tech["volume"]) == 2, "lengths")

    prefix = replace_macro_prefix("100.19（+0.26%），美元走强压制以美元计价的黄金", "101.13（+0.90%）")
    _assert(prefix is not None and prefix.startswith("101.13（+0.90%）") and prefix.endswith("美元走强压制以美元计价的黄金"), prefix)
    yprefix = replace_macro_prefix(
        "4.945%（9/21 收，-4.7BP）；9/14 盘中一度突破 5%，为 2023/10 以来首次",
        "5.114%（9/23 收，+16.7BP）",
    )
    _assert(yprefix is not None and yprefix.startswith("5.114%（9/23 收，+16.7BP）") and "9/14" in yprefix, yprefix)
    _assert(previous_weekday(date(2026, 9, 23)) == date(2026, 9, 22), "weekday")
    _assert(previous_weekday(date(2026, 9, 21)) == date(2026, 9, 18), "monday")

    # Yahoo-style duplicate bars: settled daily row plus a later live row on the same date.
    result = {
        "meta": {
            "exchangeTimezoneName": "America/New_York",
            "regularMarketPrice": 97.73,
            "regularMarketTime": 1790214755,
            "regularMarketDayHigh": 98.3,
            "regularMarketDayLow": 97.1,
            "regularMarketVolume": 1222,
        },
        "timestamp": [1790049600, 1790136000, 1790214755],
        "indicators": {
            "quote": [
                {
                    "open": [99.88, 98.23, 98.23],
                    "high": [102.29, 98.30, 98.30],
                    "low": [97.36, 97.10, 97.10],
                    "close": [99.25, None, 97.50],
                    "volume": [100, 100, 50],
                }
            ]
        },
    }
    merged, live_session, price = bars_from_yahoo(result)
    _assert(live_session == date(2026, 9, 23) and price == 97.73, f"yahoo {live_session} {price}")
    _assert(merged[date(2026, 9, 22)].close == 99.25, "prior close bar")
    _assert(merged[date(2026, 9, 23)].close == 97.73, "live close wins")
    _assert(merged[date(2026, 9, 23)].high == 98.3, f"intraday high {merged[date(2026, 9, 23)].high}")
    _assert(previous_close(merged, live_session) == 99.25, "prev")

    settled = {
        "meta": {
            "exchangeTimezoneName": "America/New_York",
            "regularMarketPrice": 97.75,
            "regularMarketTime": 1790214755,
            "regularMarketDayHigh": 98.3,
            "regularMarketDayLow": 97.1,
            "regularMarketVolume": 1400,
        },
        "timestamp": [1790049600, 1790136000, 1790214755],
        "indicators": {
            "quote": [
                {
                    "open": [99.88, 99.05, 98.23],
                    "high": [102.29, 103.86, 98.30],
                    "low": [97.36, 97.93, 97.10],
                    "close": [99.25, 103.08, 97.50],
                    "volume": [100, 200, 50],
                }
            ]
        },
    }
    merged, live_session, price = bars_from_yahoo(settled)
    _assert(live_session == date(2026, 9, 24) and price == 97.75, f"rolled {live_session} {price}")
    _assert(merged[date(2026, 9, 23)].close == 103.08, "settled close kept")
    _assert(merged[date(2026, 9, 23)].high == 103.86, "settled high kept")
    _assert(merged[date(2026, 9, 24)].high == 98.3 and merged[date(2026, 9, 24)].low == 97.1, "live range")
    _assert(previous_close(merged, live_session) == 103.08, "rolled prev")
    _assert(next_weekday(date(2026, 9, 25)) == date(2026, 9, 28), "friday rolls to monday")
    log("INFO", "self-test passed")
    return 0


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Refresh MarketTracker oil and gold numbers.")
    parser.add_argument("--dry-run", action="store_true", help="Fetch and log updates without writing JSON")
    parser.add_argument("--self-test", action="store_true", help="Run offline checks and exit")
    args = parser.parse_args(argv)
    if args.self_test:
        return self_test()
    return refresh(dry_run=args.dry_run)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
