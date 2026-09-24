#!/usr/bin/env python3
"""Refresh oil and gold numeric fields in the MarketTracker JSON snapshots.

Narrative blocks (news, timeline, signal prose, ``metrics.main.refs``, macro
``v`` text, and the whole ENSO file) are left untouched. ENSO CPC numbers are
owned by ``scripts/refresh_enso_data.py``. Live WTI, DXY, and GC prints go to
``metrics.main.quotes`` instead of being substituted into Chinese prose, so a
month label such as 「11月」 cannot be read as a price.

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


@dataclass
class Fetched:
    brent: Quote | None
    wti: Quote | None
    dxy: Quote | None
    comex: Quote | None
    yield_quote: Quote | None
    spot: float | None
    spot_source: str
    failures: list[str]


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
    if number != number or number in (float("inf"), float("-inf")):  # NaN / inf
        return None
    return number


def verified_number(value: object, ndigits: int) -> float | None:
    """Return a rounded finite number, or None when the value is not a real print."""
    number = _num(value)
    if number is None:
        return None
    return round(number, ndigits)


def put_number(bucket: dict, key: str, value: object, ndigits: int, label: str) -> bool:
    number = verified_number(value, ndigits)
    if number is None:
        log("WARN", f"{label} left unchanged; missing or invalid number")
        return False
    bucket[key] = number
    return True


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
        if wti_close is None or brent_close is None:
            log(
                "WARN",
                f"oil chart {day.isoformat()} left unappended; WTI or Brent close missing",
            )
            continue
        dates.append(f"{day.month:02d}-{day.day:02d}")
        wti_series.append(wti_close)
        brent_series.append(brent_close)
        # SC is not fetched. The empty slot keeps the four series aligned;
        # it is not a verified Shanghai close, and existing SC points are not cleared.
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


def update_oil(data: dict, brent: Quote, wti: Quote | None, dxy: Quote | None, moment: datetime) -> list[str] | None:
    price = verified_number(brent.price, 2)
    if price is None:
        log("WARN", "oil update skipped; Brent price missing")
        return None
    updated = ["snapshot", "metrics.main.num"]
    data["snapshot"] = snapshot_stamp(moment)
    main = data["metrics"]["main"]
    main["num"] = f"{price:.2f}"
    chg = change_parts(price, brent.previous_close)
    chg_text = chg[0] if chg else None
    if chg is not None:
        main["chg"] = chg[0]
        main["chgClass"] = chg[1]
        updated += ["metrics.main.chg", "metrics.main.chgClass"]
    else:
        log("WARN", "oil change left unchanged; Brent previous close missing")
    main["src"] = oil_src(moment, brent, chg_text)
    updated.append("metrics.main.src")
    # refs is narrative. Month labels such as 「11月」 stay put; live prints go to quotes.
    quotes = quote_bucket(main)
    if wti is None:
        log("WARN", "WTI quote left unchanged; CL=F unavailable")
    elif put_number(quotes, "wti", wti.price, 2, "WTI"):
        updated.append("metrics.main.quotes.wti")
    if dxy is None:
        log("WARN", "oil DXY quote left unchanged; DX-Y.NYB unavailable")
    elif put_number(quotes, "dxy", dxy.price, 2, "oil DXY"):
        updated.append("metrics.main.quotes.dxy")
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

    found_spot = False
    for item in tech.get("momentum") or []:
        key = item.get("k")
        if key == "近 20 交易日":
            text = span(20)
            if text:
                item["v"] = text
            else:
                log("WARN", "近 20 交易日 momentum left unchanged; not enough closes")
        elif key == "近 5 交易日":
            text = span(5)
            if text:
                item["v"] = text
            else:
                log("WARN", "近 5 交易日 momentum left unchanged; not enough closes")
        elif key == "今日现货":
            found_spot = True
            if not chg_text:
                log("WARN", "今日现货 momentum left unchanged; change missing")
                continue
            item["v"] = f"{chg_text}（现货）"
    if not found_spot:
        log("WARN", "momentum key 今日现货 not found; left unchanged")


def quote_bucket(main: dict) -> dict:
    quotes = main.get("quotes")
    if not isinstance(quotes, dict):
        quotes = {}
        main["quotes"] = quotes
    return quotes


def put_macro_quote(items: list, key: str, quote: dict) -> bool:
    for value in quote.values():
        if value is None or value == "":
            log("WARN", f"{key} macro quote left unchanged; empty field")
            return False
    for item in items:
        if item.get("k") == key:
            item["quote"] = quote
            return True
    log("WARN", f"{key} macro row missing; quote left unchanged")
    return False


def update_basis_row(
    data: dict,
    comex_price: float,
    spot: float,
    moment: datetime,
    spot_source: str,
) -> bool:
    gc = verified_number(comex_price, 1)
    spot_n = verified_number(spot, 2)
    if gc is None or spot_n is None:
        log("WARN", "gold basis left unchanged; GC or spot missing")
        return False
    basis = verified_number(gc - spot_n, 1)
    if basis is None or abs(basis) > 200:
        log("WARN", f"gold basis left unchanged; {basis} outside ±200 or invalid")
        return False
    table = (data.get("positioning") or {}).get("table") or []
    for row in table:
        if str(row.get("k", "")).startswith("期现基差"):
            row["gc"] = gc
            row["spot"] = spot_n
            row["basis"] = basis
            row["v"] = f"{basis:+.1f} 美元（{moment.month}/{moment.day}）"
            row["wk"] = f"{gc:.1f} − {spot_n:.2f}"
            row["dir"] = "up" if basis > 0 else "down" if basis < 0 else "flat"
            row["src"] = f"Yahoo GC=F − {source_label(spot_source)} · {snapshot_stamp(moment)} 上海"
            return True
    log("WARN", "期现基差 row missing; basis left unchanged")
    return False


def update_gold(
    data: dict,
    spot: float,
    spot_source: str,
    comex: Quote | None,
    dxy: Quote | None,
    yield_quote: Quote | None,
    moment: datetime,
) -> list[str] | None:
    spot_n = verified_number(spot, 2)
    if spot_n is None:
        log("WARN", "gold update skipped; spot missing")
        return None
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
    chg = change_parts(spot_n, prev_price)
    chg_text = chg[0] if chg else None
    main["num"] = f"{spot_n:.2f}"
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
    src += f"（现价 {spot_n:.2f}{('/' + chg_text) if chg_text else ''}） · {source_label(spot_source)}"
    main["src"] = src
    updated.append("metrics.main.src")

    quotes = quote_bucket(main)
    if comex is None:
        log("WARN", "GC quote left unchanged; GC=F unavailable")
    elif put_number(quotes, "gc", comex.price, 1, "GC"):
        updated.append("metrics.main.quotes.gc")
    if dxy is None:
        log("WARN", "gold DXY quote left unchanged; DX-Y.NYB unavailable")
    elif put_number(quotes, "dxy", dxy.price, 2, "gold DXY"):
        updated.append("metrics.main.quotes.dxy")

    try:
        action = update_gold_candles(
            data["tech"],
            spot_n,
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

    rr_price = verified_number(spot_n, 2)
    if rr_price is None:
        log("WARN", "risk-reward price left unchanged; spot missing")
    else:
        data["sentiment"]["riskReward"]["price"] = rr_price
        updated.append("sentiment.riskReward.price")

    if comex is None:
        log("WARN", "gold basis left unchanged; GC=F unavailable")
    elif update_basis_row(data, comex.price, spot_n, moment, spot_source):
        updated.append("positioning.basis")

    items = data["macro"]["items"]
    if dxy is None:
        log("WARN", "DXY macro quote left unchanged; DX-Y.NYB unavailable")
    else:
        dxy_price = verified_number(dxy.price, 2)
        dxy_chg = change_parts(dxy.price, dxy.previous_close) if dxy_price is not None else None
        if dxy_price is None or dxy_chg is None:
            log("WARN", "DXY macro quote left unchanged; previous close missing")
        elif put_macro_quote(items, "美元指数", {"value": dxy_price, "chg": dxy_chg[0]}):
            updated.append("macro.dxy.quote")
    if yield_quote is None:
        log("WARN", "yield macro quote left unchanged; ^TNX unavailable")
    else:
        yld = verified_number(yield_quote.price, 3)
        prev = yield_quote.previous_close
        if yld is None or prev is None:
            log("WARN", "yield macro quote left unchanged; previous close missing")
        else:
            bp = verified_number((yld - prev) * 100.0, 1)
            if bp is None:
                log("WARN", "yield macro quote left unchanged; basis-point change invalid")
            elif put_macro_quote(
                items,
                "美债 10 年期收益率",
                {
                    "value": yld,
                    "unit": "%",
                    "session": yield_quote.session.isoformat(),
                    "bp": bp,
                },
            ):
                updated.append("macro.yield.quote")
    return updated


def fetch_all() -> Fetched:
    failures: list[str] = []
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
    return Fetched(brent, wti, dxy, comex, yield_quote, spot, spot_source, failures)


def _display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return path.name


def refresh(
    dry_run: bool = False,
    oil_path: Path | None = None,
    gold_path: Path | None = None,
    fetched: Fetched | None = None,
) -> int:
    oil_path = OIL_PATH if oil_path is None else oil_path
    gold_path = GOLD_PATH if gold_path is None else gold_path
    moment = shanghai_now()
    log("INFO", f"refresh started at {snapshot_stamp(moment)} Asia/Shanghai")
    bundle = fetch_all() if fetched is None else fetched

    wrote = False
    if bundle.brent is None:
        log("WARN", "oil file left untouched because Brent (BZ=F) failed")
    else:
        oil = load_json(oil_path)
        fields = update_oil(oil, bundle.brent, bundle.wti, bundle.dxy, moment)
        if fields is None:
            log("WARN", "oil file left untouched because the Brent print was not usable")
        else:
            log("INFO", f"oil snapshot {oil['snapshot']} num {oil['metrics']['main']['num']} {oil['metrics']['main']['chg']}")
            log("INFO", "oil fields: " + ", ".join(fields))
            if dry_run:
                log("INFO", "dry-run: oilData.json not written")
            else:
                write_json(oil_path, oil)
                log("INFO", f"wrote {_display_path(oil_path)}")
            wrote = True

    if bundle.spot is None:
        log("WARN", "gold file left untouched because XAU/USD failed")
    else:
        gold = load_json(gold_path)
        fields = update_gold(
            gold,
            bundle.spot,
            bundle.spot_source,
            bundle.comex,
            bundle.dxy,
            bundle.yield_quote,
            moment,
        )
        if fields is None:
            log("WARN", "gold file left untouched because the spot print was not usable")
        else:
            log("INFO", f"gold snapshot {gold['snapshot']} num {gold['metrics']['main']['num']} {gold['metrics']['main']['chg']}")
            log("INFO", "gold fields: " + ", ".join(fields))
            if dry_run:
                log("INFO", "dry-run: goldData.json not written")
            else:
                write_json(gold_path, gold)
                log("INFO", f"wrote {_display_path(gold_path)}")
            wrote = True

    if bundle.failures:
        log("WARN", "series with errors: " + " | ".join(bundle.failures))
    if not wrote:
        log("ERROR", "total failure: neither oil nor gold primary quote could be updated")
        return 1
    log("INFO", "refresh finished" + (" (dry-run)" if dry_run else ""))
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
    _assert(change_parts(100.0, None) is None, "missing previous close")

    # A new session is not appended when one of the two closes is missing.
    gap = {
        "dates": ["09-23"],
        "wti": [91.83],
        "brent": [97.73],
        "sc": [None],
        "wtiHigh": 91.83,
        "brentHigh": 97.73,
    }
    brent_gap = Quote(
        "BZ=F",
        97.10,
        97.73,
        97.0,
        97.2,
        96.8,
        date(2026, 9, 24),
        {
            session: Bar(session, 98.2, 98.3, 97.1, 97.73, 12),
            date(2026, 9, 24): Bar(date(2026, 9, 24), 97.0, 97.2, 96.8, 97.10, 9),
        },
        "test",
    )
    update_oil_chart(gap, wti, brent_gap, date(2026, 9, 24))
    _assert(gap["dates"] == ["09-23"], f"no null day {gap['dates']}")
    _assert(None not in gap["wti"] and None not in gap["brent"], "no null quote appended")

    tech = {
        "candles": [{"d": "09-22", "o": 4369.0, "h": 4375.0, "l": 4291.0, "c": 4318.18}],
        "volume": [100000],
        "momentum": [
            {"k": "近 20 交易日", "v": "old"},
            {"k": "近 5 交易日", "v": "old"},
            {"k": "今日盘中", "v": "old-intraday"},
            {"k": "今日现货", "v": "-1.15%（亚欧盘回落）"},
        ],
    }
    # Not enough history for 5/20 day spans; those stay put. Today's percent updates.
    _assert(update_gold_candles(tech, 4278.4, session, 17180) == "appended", "append")
    _assert(tech["candles"][-1]["c"] == 4278.4, "spot close")
    _assert(len(tech["volume"]) == 2 and tech["volume"][-1] == 17180, "volume")
    update_momentum(tech, "-0.92%")
    spot_row = next(item for item in tech["momentum"] if item["k"] == "今日现货")
    stale_row = next(item for item in tech["momentum"] if item["k"] == "今日盘中")
    _assert(spot_row["v"] == "-0.92%（现货）", spot_row["v"])
    _assert(stale_row["v"] == "old-intraday", "legacy 今日盘中 key is not the spot slot")
    _assert(tech["momentum"][0]["v"] == "old", "short history kept")
    update_momentum(tech, None)
    _assert(spot_row["v"] == "-0.92%（现货）", "missing change does not clear 今日现货")
    _assert(update_gold_candles(tech, 4280.0, session, 17180) == "updated-today", "same session")
    _assert(tech["candles"][-1]["c"] == 4280.0 and tech["candles"][-1]["o"] == 4278.4, "open preserved")
    _assert(len(tech["candles"]) == len(tech["volume"]) == 2, "lengths")

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

    # Same-week month labels must survive. The live print goes to quotes, not into 「11月」.
    moment = datetime(2026, 9, 24, 16, 2, tzinfo=SHANGHAI)
    oil_refs = "WTI 11月 91.44（Yahoo CL=F） · 路透口径11月布伦特约102.13 · DXY 9月 100.19"
    oil_doc = {
        "snapshot": "2026-09-23 10:00",
        "metrics": {
            "main": {
                "num": "100.00",
                "chg": "-1.00%",
                "chgClass": "down",
                "src": "old",
                "refs": oil_refs,
                "quotes": {"dxy": 100.19},
            }
        },
        "charts": {
            "dates": ["09-22"],
            "wti": [94.59],
            "brent": [99.25],
            "sc": [717.1],
            "wtiHigh": 105.48,
            "brentHigh": 109.29,
        },
    }
    brent_live = Quote("BZ=F", 97.73, None, 98.2, 98.3, 97.1, session, bars, "test")
    no_wti = update_oil(oil_doc, brent_live, None, None, moment)
    _assert(no_wti is not None, "oil update")
    _assert(oil_doc["metrics"]["main"]["refs"] == oil_refs, "month label refs untouched")
    _assert("11月" in oil_doc["metrics"]["main"]["refs"], "accidental month digit 11 kept")
    _assert("9月" in oil_doc["metrics"]["main"]["refs"], "accidental month digit 9 kept")
    _assert("92.24月" not in oil_doc["metrics"]["main"]["refs"], "month was not overwritten with a price")
    _assert("wti" not in oil_doc["metrics"]["main"]["quotes"], "failed WTI is not written as null")
    _assert(oil_doc["metrics"]["main"]["quotes"]["dxy"] == 100.19, "failed DXY leaves the prior quote")
    _assert(oil_doc["metrics"]["main"]["chg"] == "-1.00%", "missing previous close does not clear chg")
    dxy_live = Quote(
        "DX-Y.NYB",
        101.13,
        100.22,
        None,
        None,
        None,
        session,
        {session: Bar(session, 100.2, 101.2, 100.1, 101.13, 1)},
        "test",
    )
    update_oil(oil_doc, brent, wti, dxy_live, moment)
    _assert(oil_doc["metrics"]["main"]["refs"] == oil_refs, "refs still untouched after a real print")
    _assert(oil_doc["metrics"]["main"]["quotes"]["wti"] == 91.83, oil_doc["metrics"]["main"]["quotes"])
    _assert(oil_doc["metrics"]["main"]["quotes"]["dxy"] == 101.13, "dxy quote")
    _assert("11" in oil_doc["metrics"]["main"]["refs"], "traditional price did not consume the month digit")

    gold_doc = {
        "snapshot": "old",
        "metrics": {
            "main": {
                "num": "1",
                "chg": "-1.15%",
                "chgClass": "down",
                "src": "old",
                "refs": "COMEX 期金 GC 12月 4310.0 · DXY 9月 100.00",
                "quotes": {"gc": 4310.0, "dxy": 100.00},
            }
        },
        "tech": tech,
        "sentiment": {"riskReward": {"price": 1}},
        "positioning": {
            "table": [
                {
                    "k": "期现基差 GC−现货",
                    "v": "+1.0 美元（9/22）",
                    "wk": "100.0 − 99.00",
                    "gc": 100.0,
                    "spot": 99.0,
                    "basis": 1.0,
                    "dir": "up",
                    "src": "old",
                }
            ]
        },
        "macro": {
            "items": [
                {"k": "美元指数", "v": "叙述保持不动", "quote": {"value": 100.0, "chg": "+0.10%"}},
                {
                    "k": "美债 10 年期收益率",
                    "v": "收益率叙述保持不动",
                    "quote": {"value": 4.0, "unit": "%", "session": "2026-09-22", "bp": -1.0},
                },
            ]
        },
    }
    comex = Quote(
        "GC=F",
        4320.0,
        4310.0,
        4312.0,
        4322.0,
        4308.0,
        session,
        {session: Bar(session, 4312.0, 4322.0, 4308.0, 4320.0, 20)},
        "test",
    )
    yld = Quote("^TNX", 5.114, 4.947, None, None, None, session, {}, "test")
    update_gold(gold_doc, 4280.0, "https://api.gold-api.com/price/XAU", comex, dxy_live, yld, moment)
    _assert("12月" in gold_doc["metrics"]["main"]["refs"], "GC month label kept")
    _assert("9月" in gold_doc["metrics"]["main"]["refs"], "DXY month label kept")
    _assert(gold_doc["metrics"]["main"]["quotes"]["gc"] == 4320.0, "gc quote")
    _assert(gold_doc["metrics"]["main"]["quotes"]["dxy"] == 101.13, "gold dxy quote")
    basis_row = gold_doc["positioning"]["table"][0]
    _assert(basis_row["gc"] == 4320.0 and basis_row["spot"] == 4280.0 and basis_row["basis"] == 40.0, basis_row)
    _assert(basis_row["wk"] == "4320.0 − 4280.00", basis_row["wk"])
    _assert(basis_row["v"] == "+40.0 美元（9/24）", basis_row["v"])
    _assert(gold_doc["macro"]["items"][0]["v"] == "叙述保持不动", "macro prose kept")
    _assert(gold_doc["macro"]["items"][0]["quote"] == {"value": 101.13, "chg": "+0.91%"}, gold_doc["macro"]["items"][0]["quote"])
    _assert(gold_doc["macro"]["items"][1]["v"] == "收益率叙述保持不动", "yield prose kept")
    _assert(gold_doc["macro"]["items"][1]["quote"]["value"] == 5.114, "yield value")
    _assert(gold_doc["macro"]["items"][1]["quote"]["bp"] == 16.7, gold_doc["macro"]["items"][1]["quote"])
    saved_wk = basis_row["wk"]
    update_gold(gold_doc, 4280.0, "https://api.gold-api.com/price/XAU", None, None, None, moment)
    _assert(gold_doc["positioning"]["table"][0]["wk"] == saved_wk, "failed GC leaves basis fields")
    _assert(gold_doc["metrics"]["main"]["quotes"]["gc"] == 4320.0, "failed GC leaves quote")
    _assert(gold_doc["macro"]["items"][0]["quote"]["value"] == 101.13, "failed DXY leaves macro quote")

    tmp = Path(tempfile.mkdtemp())
    oil_path = tmp / "oil.json"
    gold_path = tmp / "gold.json"
    oil_path.write_text(json.dumps(oil_doc, ensure_ascii=False), encoding="utf-8")
    gold_path.write_text(json.dumps(gold_doc, ensure_ascii=False), encoding="utf-8")
    before_oil = oil_path.read_text(encoding="utf-8")
    before_gold = gold_path.read_text(encoding="utf-8")
    bundle = Fetched(brent, wti, dxy_live, comex, yld, 4280.0, "https://api.gold-api.com/price/XAU", [])
    dry = refresh(dry_run=True, oil_path=oil_path, gold_path=gold_path, fetched=bundle)
    _assert(dry == 0, f"dry-run exit {dry}")
    _assert(oil_path.read_text(encoding="utf-8") == before_oil, "dry-run does not write oil")
    _assert(gold_path.read_text(encoding="utf-8") == before_gold, "dry-run does not write gold")
    wrote = refresh(dry_run=False, oil_path=oil_path, gold_path=gold_path, fetched=bundle)
    _assert(wrote == 0, f"write exit {wrote}")
    written_oil = json.loads(oil_path.read_text(encoding="utf-8"))
    _assert(written_oil["metrics"]["main"]["quotes"]["wti"] == 91.83, "dry-run false still writes")
    _assert("11月" in written_oil["metrics"]["main"]["refs"], "written refs keep the month")
    empty = Fetched(None, None, None, None, None, None, "", ["all failed"])
    oil_path.write_text(before_oil, encoding="utf-8")
    failed = refresh(dry_run=False, oil_path=oil_path, gold_path=gold_path, fetched=empty)
    _assert(failed == 1, "total failure")
    _assert(oil_path.read_text(encoding="utf-8") == before_oil, "failed refresh does not write")
    script_body = Path(__file__).read_text(encoding="utf-8").split("def self_test", 1)[0]
    _assert("ensoData" not in script_body, "ENSO stays out of this script")
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
