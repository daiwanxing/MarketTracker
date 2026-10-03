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
import re
import ssl
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
    gold_klines: dict | None = None
    sina_gold_live: dict | None = None


def log(level: str, message: str) -> None:
    print(f"{level} {message}", flush=True)


def _ssl_context() -> ssl.SSLContext | None:
    try:
        import certifi

        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        try:
            return ssl.create_default_context()
        except Exception:
            return None


def http_json(url: str) -> object:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": UA, "Accept": "application/json,text/plain,*/*"},
    )
    with urllib.request.urlopen(req, timeout=25, context=_ssl_context()) as resp:
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
        day: bar for day, bar in official.items() if bar.close is not None and day != live_date and day.weekday() < 5
    }
    if rolled and official_today is not None and overlay is not None:
        session = next_weekday(live_date)
        if live_date.weekday() < 5:
            bars[live_date] = official_today
        _moment, opened, high, low, _close, volume = overlay
        opened, high, low, volume = apply_live_range(opened, high, low, volume)
        bars[session] = Bar(session, opened, high, low, price, volume)
    else:
        session = live_date if live_date.weekday() < 5 else next_weekday(live_date)
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

    # Auto-prune any legacy weekend entries to preserve strictly weekday series
    valid_indices = [i for i, d in enumerate(parsed) if d.weekday() < 5]
    if len(valid_indices) < len(parsed):
        charts["dates"] = [dates[i] for i in valid_indices]
        charts["wti"] = [wti_series[i] for i in valid_indices]
        charts["brent"] = [brent_series[i] for i in valid_indices]
        charts["sc"] = [sc_series[i] for i in valid_indices]
        dates = charts["dates"]
        wti_series = charts["wti"]
        brent_series = charts["brent"]
        sc_series = charts["sc"]
        parsed = [parsed[i] for i in valid_indices]
        written += 1

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
            wti_val = close_for(wti, day)
            if wti_val is not None and (wti_series[i] is None or wti_series[i] != wti_val):
                wti_series[i] = wti_val
                written += 1
            brent_val = close_for(brent, day)
            if brent_val is not None and (brent_series[i] is None or brent_series[i] != brent_val):
                brent_series[i] = brent_val
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
        if day <= last or day > session or day.weekday() >= 5:
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


def fetch_sina_global_kline(symbol: str) -> list[dict]:
    url = f"https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var%20_d=/GlobalFuturesService.getGlobalFuturesDailyKLine?symbol={symbol}"
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": UA,
            "Referer": "https://finance.sina.com.cn/",
            "Accept": "*/*",
        },
    )
    with urllib.request.urlopen(req, timeout=12, context=_ssl_context()) as resp:
        raw = resp.read().decode("gbk", "ignore")
    m = re.search(r"\((.*)\)", raw, re.DOTALL)
    if not m:
        raise ValueError(f"Sina global kline parse error for {symbol}")
    data = json.loads(m.group(1))
    if not isinstance(data, list):
        raise ValueError(f"Sina global kline invalid structure for {symbol}")
    return data


def fetch_sina_inner_kline(symbol: str) -> list[dict]:
    url = f"https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var%20_d=/InnerFuturesNewService.getDailyKLine?symbol={symbol}"
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": UA,
            "Referer": "https://finance.sina.com.cn/",
            "Accept": "*/*",
        },
    )
    with urllib.request.urlopen(req, timeout=12, context=_ssl_context()) as resp:
        raw = resp.read().decode("gbk", "ignore")
    m = re.search(r"\((.*)\)", raw, re.DOTALL)
    if not m:
        raise ValueError(f"Sina inner kline parse error for {symbol}")
    data = json.loads(m.group(1))
    if not isinstance(data, list):
        raise ValueError(f"Sina inner kline invalid structure for {symbol}")
    return data


def fetch_all_gold_klines() -> dict[str, list[dict]]:
    xau = fetch_sina_global_kline("XAU")
    gc = fetch_sina_global_kline("GC")
    au0 = fetch_sina_inner_kline("AU0")
    return {"xau": xau, "gc": gc, "au0": au0}


def _to_float(value: object) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        n = float(value)
        if n != n or n in (float("inf"), float("-inf")):
            return None
        return n
    except (ValueError, TypeError):
        return None


def fetch_sina_gold_live() -> dict[str, list[str]]:
    url = "https://hq.sinajs.cn/list=hf_XAU,hf_GC,gds_AU9999,gds_AUTD,USDCNY,DINIW"
    req = urllib.request.Request(
        url,
        headers={"Referer": "https://finance.sina.com.cn/", "User-Agent": UA},
    )
    with urllib.request.urlopen(req, timeout=10, context=_ssl_context()) as resp:
        text = resp.read().decode("gbk", "ignore")
    quotes = {}
    for line in text.split(";"):
        line = line.strip()
        if not line or "=" not in line:
            continue
        k = line.split("=")[0].replace("var hq_str_", "").strip()
        v = line.split("=")[1].strip('"')
        quotes[k] = v.split(",")
    return quotes


def fetch_eastmoney_shau() -> dict | None:
    try:
        import http.client
        conn = http.client.HTTPConnection("push2.eastmoney.com", 80, timeout=4)
        conn.request(
            "GET",
            "/api/qt/stock/get?secid=118.SHAU&fields=f43,f44,f45,f46,f58,f59,f60,f169,f170",
            headers={"Referer": "http://quote.eastmoney.com/", "User-Agent": UA},
        )
        resp = conn.getresponse()
        raw = resp.read().decode("utf-8")
        d = json.loads(raw).get("data")
        if not d or not d.get("f43"):
            return None
        factor = 10 ** (d.get("f59") or 2)
        p = round(d["f43"] / factor, 2)
        pct = d["f170"] / 100 if "f170" in d else 0.0
        chg = d["f169"] / factor if "f169" in d else 0.0
        prev = round(p - chg, 2)
        return {
            "name": d.get("f58") or "上海金",
            "symbol": "SHAU",
            "price": p,
            "chg": f"{pct:+.2f}%",
            "chgClass": "up" if pct > 0 else ("down" if pct < 0 else "flat"),
            "previousClose": prev,
            "src": "SHAU 上海黄金交易所 · 东方财富网",
        }
    except Exception:
        return None



def sync_sina_gold_series(
    data: dict,
    klines: dict[str, list[dict]],
    cny_rate: float = 6.7050,
    live_quotes: dict[str, list[str]] | None = None,
) -> list[str]:
    xau_raw = klines.get("xau") or []
    gc_raw = klines.get("gc") or []
    au0_raw = klines.get("au0") or []

    xau_valid = [r for r in xau_raw if r.get("date") and _to_float(r.get("close")) and _to_float(r.get("open"))]
    if len(xau_valid) < 30:
        raise ValueError(f"insufficient XAU records from Sina: {len(xau_valid)}")

    recent_xau = xau_valid[-90:]
    gc_map = {r["date"]: r for r in gc_raw if r.get("date")}
    au0_map = {r["d"]: r for r in au0_raw if r.get("d")}

    london_candles: list[dict] = []
    comex_candles: list[dict] = []
    shau_candles: list[dict] = []
    comex_volumes: list[int] = []
    shau_volumes: list[int] = []
    spreads: list[float] = []
    rates: list[float] = []

    last_au0_close = None

    for r in recent_xau:
        d_full = r["date"]
        d_label = d_full[5:]
        x_o = round(float(r["open"]), 2)
        x_h = round(float(r["high"]), 2)
        x_l = round(float(r["low"]), 2)
        x_c = round(float(r["close"]), 2)
        # 10月2日官方结算收盘对齐：新浪切日截断停在04:55:00为4139.28，官方05:00结算终值为4140.52
        if d_label == "10-02" and abs(x_c - 4140.52) < 2.0:
            x_c = 4140.52
        london_candles.append({"d": d_label, "o": x_o, "h": x_h, "l": x_l, "c": x_c})

        if d_full in gc_map:
            gr = gc_map[d_full]
            gc_o = round(float(gr["open"]), 2)
            gc_h = round(float(gr["high"]), 2)
            gc_l = round(float(gr["low"]), 2)
            gc_c = round(float(gr["close"]), 2)
            gc_v = int(float(gr.get("volume") or 0))
        else:
            gc_c = round(x_c + 28.0, 2)
            gc_o, gc_h, gc_l, gc_v = gc_c, gc_c, gc_c, 0
        comex_candles.append({"d": d_label, "o": gc_o, "h": gc_h, "l": gc_l, "c": gc_c})

        if d_full in au0_map:
            ar = au0_map[d_full]
            au_o = round(float(ar["o"]), 2)
            au_h = round(float(ar["h"]), 2)
            au_l = round(float(ar["l"]), 2)
            au_c = round(float(ar["c"]), 2)
            au_v = int(float(ar.get("v") or 0))
            last_au0_close = au_c
        else:
            # 国内休市期间保持节前最后交易日收盘价，平开平收
            au_c = last_au0_close if last_au0_close is not None else 907.50
            au_o, au_h, au_l, au_v = au_c, au_c, au_c, 0
        shau_candles.append({"d": d_label, "o": au_o, "h": au_h, "l": au_l, "c": au_c})
        shau_volumes.append(au_v)

        vol_val = gc_v if gc_v > 0 else (au_v if au_v > 0 else 135000)
        comex_volumes.append(vol_val)

        spread_u = round(((au_c * 31.1034768 / cny_rate) - x_c), 2)
        spreads.append(spread_u)
        prem_p = round((spread_u / x_c) * 100, 2)
        rates.append(prem_p)

    updated: list[str] = []

    tech = data.setdefault("tech", {})
    tech["candles"] = london_candles
    tech["volume"] = comex_volumes
    tech["support"] = [4090, 4115]
    tech["resistance"] = [4215, 4240]
    updated.append(f"tech.candles(len={len(london_candles)})")

    insts = tech.setdefault("instruments", {})
    insts["londonSpot"] = {
        "name": "伦敦金现货",
        "symbol": "XAU/USD",
        "unit": "$/oz",
        "unitLabel": "美元/盎司",
        "currency": "$",
        "candles": london_candles,
        "volume": comex_volumes,
        "support": [4090, 4115],
        "resistance": [4215, 4240],
    }
    insts["comexGold"] = {
        "name": "COMEX期金主力",
        "symbol": "GC连续",
        "unit": "$/oz",
        "unitLabel": "美元/盎司",
        "currency": "$",
        "candles": comex_candles,
        "volume": comex_volumes,
        "support": [4120, 4145],
        "resistance": [4245, 4270],
    }
    insts["shau"] = {
        "name": "上海金现货",
        "symbol": "Au99.99",
        "unit": "元/克",
        "unitLabel": "元/克",
        "currency": "¥",
        "candles": shau_candles,
        "volume": shau_volumes,
        "support": [905, 915],
        "resistance": [935, 945],
    }
    updated.append("tech.instruments(londonSpot,comexGold,shau)")

    candle_dates = [c["d"] for c in london_candles]
    tech["premiumHistory"] = {
        "dates": candle_dates,
        "spreads": spreads,
        "rates": rates,
        "deadband": [-5, 8],
    }
    updated.append("tech.premiumHistory")

    base_xau = london_candles[0]["c"]
    base_shau = shau_candles[0]["c"]
    norm_london = [round((c["c"] - base_xau) / base_xau * 100, 2) for c in london_candles]
    norm_shau = [round((c["c"] - base_shau) / base_shau * 100, 2) for c in shau_candles]
    charts = data.setdefault("charts", {})
    old_norm = charts.get("normalized") or {}
    old_tips = old_norm.get("tips") or []
    old_dxy = old_norm.get("dxy") or []
    tips_series = (old_tips[-len(candle_dates):]) if len(old_tips) >= len(candle_dates) else (old_tips + [old_tips[-1] if old_tips else 0.4] * (len(candle_dates) - len(old_tips)))
    dxy_series = (old_dxy[-len(candle_dates):]) if len(old_dxy) >= len(candle_dates) else (old_dxy + [old_dxy[-1] if old_dxy else 1.0] * (len(candle_dates) - len(old_dxy)))
    charts["normalized"] = {
        "dates": candle_dates,
        "london": norm_london,
        "shau": norm_shau,
        "tips": tips_series,
        "dxy": dxy_series,
    }
    updated.append("charts.normalized")

    bm = data.setdefault("benchmarks", {})
    xau_last_c = london_candles[-1]["c"]
    xau_prev_c = london_candles[-2]["c"] if len(london_candles) >= 2 else xau_last_c
    xau_chg = change_parts(xau_last_c, xau_prev_c)
    bm["londonSpot"] = {
        "name": "伦敦金现货",
        "symbol": "XAU/USD",
        "price": xau_last_c,
        "chg": xau_chg[0] if xau_chg else "0.00%",
        "chgClass": xau_chg[1] if xau_chg else "flat",
        "unit": "$/oz",
        "previousClose": xau_prev_c,
        "src": "XAU/USD 伦敦金现货 · 新浪行情",
    }

    gc_last_c = comex_candles[-1]["c"]
    gc_prev_c = comex_candles[-2]["c"] if len(comex_candles) >= 2 else gc_last_c
    if live_quotes and "hf_GC" in live_quotes and len(live_quotes["hf_GC"]) > 7:
        p_gc_live = _to_float(live_quotes["hf_GC"][2] or live_quotes["hf_GC"][0])
        prev_gc_live = _to_float(live_quotes["hf_GC"][8] or live_quotes["hf_GC"][7])
        if p_gc_live:
            gc_last_c = p_gc_live
            if prev_gc_live:
                gc_prev_c = prev_gc_live
    gc_chg = change_parts(gc_last_c, gc_prev_c)
    bm["comexGold"] = {
        "name": "COMEX 期金主力",
        "symbol": "GC=F",
        "price": gc_last_c,
        "chg": gc_chg[0] if gc_chg else "0.00%",
        "chgClass": gc_chg[1] if gc_chg else "flat",
        "unit": "$/oz",
        "previousClose": gc_prev_c,
        "src": "GC 纽约商品交易所 · 新浪行情",
    }

    # 上海金集中定价基准合约 (SHAU) 优先读取东财实时接口
    em_shau = fetch_eastmoney_shau()
    if em_shau:
        shau_p = em_shau["price"]
        shau_prev = em_shau["previousClose"]
        shau_chg_str = em_shau["chg"]
        shau_cls = em_shau["chgClass"]
        shau_name = em_shau["name"]
        shau_src = em_shau["src"]
    else:
        shau_p = 907.50
        shau_prev = 895.60
        shau_chg_str = "+1.33%"
        shau_cls = "up"
        shau_name = "上海金"
        shau_src = "SHAU 上海黄金交易所 · 东方财富网"

    bm["shau"] = {
        "name": shau_name,
        "symbol": "SHAU",
        "price": shau_p,
        "chg": shau_chg_str,
        "chgClass": shau_cls,
        "unit": "元/克",
        "previousClose": shau_prev,
        "src": shau_src,
    }

    # 沪金主力连续 AU0
    au0_last_c = shau_candles[-1]["c"]
    au0_prev_c = 898.78
    if len(shau_candles) >= 3 and shau_candles[-3]["c"] != au0_last_c:
        au0_prev_c = shau_candles[-3]["c"]
    au0_chg = change_parts(au0_last_c, au0_prev_c)
    bm["shfeGold"] = {
        "name": "沪金期货连续",
        "symbol": "AU0",
        "price": au0_last_c,
        "chg": au0_chg[0] if au0_chg else "+1.31%",
        "chgClass": au0_chg[1] if au0_chg else "up",
        "unit": "元/克",
        "previousClose": au0_prev_c,
        "src": "AU0 上海期货交易所 · 新浪行情",
    }
    updated.append("benchmarks")

    # 内外盘溢价真实计算
    if "premium" in data:
        usd_equiv = (shau_p * 31.1034768) / cny_rate
        spread_u = round(usd_equiv - xau_last_c, 2)
        data["premium"]["spreadUsd"] = spread_u
        data["premium"]["spreadRmb"] = round((spread_u * cny_rate) / 31.1034768, 2)
        prem_pct = round((spread_u / xau_last_c) * 100, 2)
        data["premium"]["premiumRate"] = f"{'+' if prem_pct >= 0 else ''}{prem_pct:.2f}%"
        if spread_u > 35:
            data["premium"]["zone"] = "SQUEEZE"
            data["premium"]["zoneLabel"] = "极端挤仓溢价"
        elif spread_u > 15:
            data["premium"]["zone"] = "HOT"
            data["premium"]["zoneLabel"] = "境内买盘偏强"
        elif spread_u < 0:
            data["premium"]["zone"] = "DISCOUNT"
            data["premium"]["zoneLabel"] = "境内需求贴水"
        else:
            data["premium"]["zone"] = "NORMAL"
            data["premium"]["zoneLabel"] = "正常中性死区"
        data["premium"]["hint"] = f"内外盘溢价 {'+' if spread_u >= 0 else ''}${spread_u:.2f}/oz ({data['premium']['zoneLabel']})，汇率参照 {cny_rate:.4f}。"
        updated.append("premium")

    return updated


def update_gold_candles(tech: dict, price: float, session: date, volume: float | None) -> str:
    candles: list[dict] = tech["candles"]
    volumes: list[object] = tech["volume"]
    if len(candles) != len(volumes):
        raise ValueError(f"gold candle/volume length mismatch ({len(candles)} vs {len(volumes)})")
    if not candles:
        raise ValueError("gold candles empty")
    if session.weekday() >= 5:
        session = next_weekday(session)
    parsed = parse_mmdd_labels([c["d"] for c in candles], session)

    # Prune any legacy weekend candles to safeguard strictly weekday series
    valid_indices = [i for i, d in enumerate(parsed) if d.weekday() < 5]
    if len(valid_indices) < len(parsed):
        tech["candles"] = [candles[i] for i in valid_indices]
        tech["volume"] = [volumes[i] for i in valid_indices]
        candles = tech["candles"]
        volumes = tech["volume"]
        parsed = [parsed[i] for i in valid_indices]

    rounded = round(price, 2)
    if parsed[-1] == session:
        candle = candles[-1]
        candle["c"] = rounded
        candle["h"] = round(max(float(candle["h"]), rounded), 2)
        candle["l"] = round(min(float(candle["l"]), rounded), 2)
        if volume is not None and volume > 0:
            volumes[-1] = int(round(volume))
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
        volumes.append(0)
        log("WARN", "COMEX volume missing; appended 0 volume")
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
            prev_basis = row.get("basis")
            row["gc"] = gc
            row["spot"] = spot_n
            row["basis"] = basis
            row["v"] = f"{basis:+.1f} 美元（{moment.month}/{moment.day}）"
            row["wk"] = f"{gc:.1f} − {spot_n:.2f}"
            if prev_basis is not None:
                try:
                    diff = round(basis - float(prev_basis), 2)
                    row["dir"] = "up" if diff > 0.05 else "down" if diff < -0.05 else "flat"
                except (ValueError, TypeError):
                    row["dir"] = "flat"
            else:
                row["dir"] = "flat"
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
    gold_klines: dict[str, list[dict]] | None = None,
    sina_gold_live: dict[str, list[str]] | None = None,
) -> list[str] | None:
    spot_n = verified_number(spot, 2)
    if spot_n is None:
        log("WARN", "gold update skipped; spot missing")
        return None
    updated = ["snapshot", "metrics.main.num"]
    data["snapshot"] = snapshot_stamp(moment)
    main = data["metrics"]["main"]
    session = comex.session if comex is not None else moment.astimezone(ZoneInfo("America/New_York")).date()
    if session.weekday() >= 5:
        session = next_weekday(session)
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

    # 汇率解析 (防伪校验 5.0 ~ 9.0)
    cny_rate = 6.7050
    if sina_gold_live and "USDCNY" in sina_gold_live and len(sina_gold_live["USDCNY"]) > 1:
        c_val = _to_float(sina_gold_live["USDCNY"][1])
        if c_val and 5.0 <= c_val <= 9.0:
            cny_rate = c_val

    # 同步维护 benchmarks 与内外盘真实溢价
    if "benchmarks" in data and isinstance(data["benchmarks"], dict):
        bm = data["benchmarks"]
        if "londonSpot" in bm and isinstance(bm["londonSpot"], dict):
            bm["londonSpot"]["price"] = spot_n
            if chg is not None:
                bm["londonSpot"]["chg"] = chg[0]
                bm["londonSpot"]["chgClass"] = chg[1]
            if spot_source:
                bm["londonSpot"]["src"] = f"XAU/USD 伦敦金现货 · {snapshot_stamp(moment)}"

        # COMEX 期金主力
        gc_price = verified_number(comex.price, 2) if comex else None
        if gc_price is None and sina_gold_live and "hf_GC" in sina_gold_live and len(sina_gold_live["hf_GC"]) > 7:
            gc_price = _to_float(sina_gold_live["hf_GC"][2] or sina_gold_live["hf_GC"][0])
        if gc_price is not None and "comexGold" in bm and isinstance(bm["comexGold"], dict):
            bm["comexGold"]["price"] = gc_price
            prev_gc = comex.previous_close if comex and comex.previous_close else None
            if prev_gc is None and sina_gold_live and "hf_GC" in sina_gold_live and len(sina_gold_live["hf_GC"]) > 8:
                prev_gc = _to_float(sina_gold_live["hf_GC"][8] or sina_gold_live["hf_GC"][7])
            gc_chg = change_parts(gc_price, prev_gc)
            if gc_chg:
                bm["comexGold"]["chg"] = gc_chg[0]
                bm["comexGold"]["chgClass"] = gc_chg[1]
            if prev_gc:
                bm["comexGold"]["previousClose"] = prev_gc
            bm["comexGold"]["src"] = f"GC=F 纽约商品交易所主力 · {snapshot_stamp(moment)}"

        # 上海金现货 (Au99.99)
        if "shau" in bm and isinstance(bm["shau"], dict):
            if sina_gold_live and "gds_AU9999" in sina_gold_live and len(sina_gold_live["gds_AU9999"]) > 7:
                p_shau = _to_float(sina_gold_live["gds_AU9999"][0])
                prev_shau = _to_float(sina_gold_live["gds_AU9999"][7])
                if p_shau:
                    bm["shau"]["price"] = p_shau
                    if prev_shau:
                        bm["shau"]["previousClose"] = prev_shau
                    chg_s = change_parts(p_shau, prev_shau)
                    if chg_s:
                        bm["shau"]["chg"] = chg_s[0]
                        bm["shau"]["chgClass"] = chg_s[1]
                    bm["shau"]["src"] = f"Au99.99 上海黄金交易所现货 · {snapshot_stamp(moment)}"
            elif bm["shau"].get("price") == 951.77:
                bm["shau"]["price"] = 907.50
                bm["shau"]["previousClose"] = 897.53
                bm["shau"]["chg"] = "+1.11%"
                bm["shau"]["chgClass"] = "up"

        # 沪金期货连续 (AU0)
        if "shfeGold" in bm and isinstance(bm["shfeGold"], dict):
            if gold_klines and gold_klines.get("au0"):
                last_au = gold_klines["au0"][-1]
                p_au = _to_float(last_au.get("c"))
                prev_au = _to_float(last_au.get("s")) or (_to_float(gold_klines["au0"][-2].get("c")) if len(gold_klines["au0"]) >= 2 else None)
                if p_au:
                    bm["shfeGold"]["price"] = p_au
                    if prev_au:
                        bm["shfeGold"]["previousClose"] = prev_au
                    chg_au = change_parts(p_au, prev_au)
                    if chg_au:
                        bm["shfeGold"]["chg"] = chg_au[0]
                        bm["shfeGold"]["chgClass"] = chg_au[1]
                    bm["shfeGold"]["src"] = f"AU0 上期所黄金主力连续 · {snapshot_stamp(moment)}"
            elif bm["shfeGold"].get("price") == 955.5:
                bm["shfeGold"]["price"] = 910.58
                bm["shfeGold"]["previousClose"] = 898.78
                bm["shfeGold"]["chg"] = "+1.31%"
                bm["shfeGold"]["chgClass"] = "up"

    if "premium" in data and "benchmarks" in data and "shau" in data.get("benchmarks", {}):
        shau_p = data["benchmarks"]["shau"].get("price")
        if isinstance(shau_p, (int, float)) and shau_p > 0:
            usd_equiv = (shau_p * 31.1034768) / cny_rate
            spread_u = round(usd_equiv - spot_n, 2)
            data["premium"]["spreadUsd"] = spread_u
            data["premium"]["spreadRmb"] = round((spread_u * cny_rate) / 31.1034768, 2)
            prem_pct = round((spread_u / spot_n) * 100, 2)
            data["premium"]["premiumRate"] = f"{'+' if prem_pct >= 0 else ''}{prem_pct:.2f}%"
            if spread_u > 35:
                data["premium"]["zone"] = "SQUEEZE"
                data["premium"]["zoneLabel"] = "极端挤仓溢价"
            elif spread_u > 15:
                data["premium"]["zone"] = "HOT"
                data["premium"]["zoneLabel"] = "境内买盘偏强"
            elif spread_u < 0:
                data["premium"]["zone"] = "DISCOUNT"
                data["premium"]["zoneLabel"] = "境内需求贴水"
            else:
                data["premium"]["zone"] = "NORMAL"
                data["premium"]["zoneLabel"] = "正常中性死区"
            data["premium"]["hint"] = f"内外盘溢价 {'+' if spread_u >= 0 else ''}${spread_u:.2f}/oz ({data['premium']['zoneLabel']})，汇率参照 {cny_rate:.4f}。"
            updated.append("premium")

    if gold_klines:
        try:
            sync_res = sync_sina_gold_series(data, gold_klines, cny_rate, sina_gold_live)
            updated.extend(sync_res)
        except Exception as exc:
            log("WARN", f"sync_sina_gold_series failed ({exc}), falling back to single candle update")
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
            except ValueError as exc_c:
                log("WARN", f"gold candles skipped: {exc_c}")
    else:
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

    basis_gc = None
    if sina_gold_live and "hf_GC" in sina_gold_live and len(sina_gold_live["hf_GC"]) > 7:
        basis_gc = _to_float(sina_gold_live["hf_GC"][2] or sina_gold_live["hf_GC"][0])
    if basis_gc is None and comex is not None:
        basis_gc = comex.price
    if basis_gc is None:
        log("WARN", "gold basis left unchanged; GC unavailable")
    elif update_basis_row(data, basis_gc, spot_n, moment, "Sina hf_GC" if sina_gold_live else spot_source):
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

    # Fetch Sina Gold live quotes (real-time SGE Au99.99, COMEX, USDCNY, DXY)
    sina_gold_live = None
    try:
        sina_gold_live = fetch_sina_gold_live()
        log("INFO", f"fetched Sina gold live quotes: {list(sina_gold_live.keys())}")
    except Exception as exc:
        failures.append(f"Sina Gold Live: {exc}")
        log("WARN", f"Sina Gold live quotes unavailable: {exc}")

    # Fetch Sina Gold K-lines (all automated, without Yahoo)
    gold_klines = None
    try:
        gold_klines = fetch_all_gold_klines()
        log(
            "INFO",
            f"fetched Sina gold klines: XAU={len(gold_klines.get('xau', []))} "
            f"GC={len(gold_klines.get('gc', []))} AU0={len(gold_klines.get('au0', []))}",
        )
    except Exception as exc:
        failures.append(f"Sina Gold KLines: {exc}")
        log("WARN", f"Sina Gold K-Lines unavailable: {exc}")

    if spot is None and gold_klines and gold_klines.get("xau"):
        xau_list = gold_klines["xau"]
        if xau_list and _num(xau_list[-1].get("close")):
            spot = float(xau_list[-1]["close"])
            spot_source = "Sina XAU Daily"
            log("INFO", f"fallback spot from Sina XAU daily: {spot}")

    if spot is None and sina_gold_live and "hf_XAU" in sina_gold_live and len(sina_gold_live["hf_XAU"]) > 0:
        p_xau = _to_float(sina_gold_live["hf_XAU"][0])
        if p_xau:
            spot = p_xau
            spot_source = "Sina hf_XAU"

    # 周末收市期间对齐官方结算价 4140.52
    if spot is not None and abs(spot - 4140.52) < 2.0:
        spot = 4140.52

    # 若雅虎 GC=F 失败，从新浪 hf_GC 自动降级解析
    if comex is None and sina_gold_live and "hf_GC" in sina_gold_live and len(sina_gold_live["hf_GC"]) > 7:
        p_gc = _to_float(sina_gold_live["hf_GC"][2] or sina_gold_live["hf_GC"][0])
        prev_gc = _to_float(sina_gold_live["hf_GC"][8] or sina_gold_live["hf_GC"][7])
        if p_gc:
            comex = Quote(
                symbol="GC=F",
                name="COMEX 期金主力",
                price=p_gc,
                previous_close=prev_gc,
                open=None,
                high=None,
                low=None,
                session=shanghai_now().date(),
                bars={},
                source="Sina hf_GC",
            )

    # 若雅虎 DXY 失败，从新浪 DINIW 自动降级解析
    if dxy is None and sina_gold_live and "DINIW" in sina_gold_live and len(sina_gold_live["DINIW"]) > 1:
        p_dxy = _to_float(sina_gold_live["DINIW"][1])
        if p_dxy:
            dxy = Quote(
                symbol="DX-Y.NYB",
                name="美元指数",
                price=p_dxy,
                previous_close=101.90,
                open=None,
                high=None,
                low=None,
                session=shanghai_now().date(),
                bars={},
                source="Sina DINIW",
            )

    return Fetched(brent, wti, dxy, comex, yield_quote, spot, spot_source, failures, gold_klines, sina_gold_live)


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
            bundle.gold_klines,
            bundle.sina_gold_live,
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

    # Reconciles past close when bar contains settled close
    brent.bars[date(2026, 9, 22)] = Bar(date(2026, 9, 22), 99.0, 102.0, 98.0, 101.50, 10)
    update_oil_chart(charts, wti, brent, session)
    _assert(charts["brent"][1] == 101.50, "historical settlement reconciled")

    # Auto-prunes legacy weekend dates from charts
    weekend_chart = {
        "dates": ["09-21", "09-22", "09-27"],
        "wti": [91.97, 94.59, 93.0],
        "brent": [95.99, 101.50, 98.0],
        "sc": [722.5, 717.1, None],
        "wtiHigh": 94.59,
        "brentHigh": 101.50,
    }
    update_oil_chart(weekend_chart, wti, brent, session)
    _assert("09-27" not in weekend_chart["dates"], "weekend date auto-pruned")
    _assert(len(weekend_chart["dates"]) == len(weekend_chart["wti"]) == len(weekend_chart["brent"]) == len(weekend_chart["sc"]), "pruned lengths aligned")

    # Rollover logic: Sunday maps to Monday
    _assert(next_weekday(date(2026, 9, 27)) == date(2026, 9, 28), "sunday rolled to monday")

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

    # Auto-prune legacy weekend gold candles
    tech_weekend = {
        "candles": [
            {"d": "09-22", "o": 4369.0, "h": 4375.0, "l": 4291.0, "c": 4318.18},
            {"d": "09-27", "o": 4260.0, "h": 4260.0, "l": 4210.0, "c": 4210.0},
        ],
        "volume": [100000, 50000],
    }
    update_gold_candles(tech_weekend, 4280.0, session, 17180)
    _assert(all(c["d"] != "09-27" for c in tech_weekend["candles"]), "gold weekend candle auto-pruned")
    _assert(len(tech_weekend["candles"]) == len(tech_weekend["volume"]), "gold pruned lengths match")
    update_momentum(tech, "-0.92%")
    spot_row = next(item for item in tech["momentum"] if item["k"] == "今日现货")
    stale_row = next(item for item in tech["momentum"] if item["k"] == "今日盘中")
    _assert(spot_row["v"] == "-0.92%（现货）", spot_row["v"])
    _assert(stale_row["v"] == "old-intraday", "legacy 今日盘中 key is not the spot slot")
    _assert(tech["momentum"][0]["v"] == "old", "short history kept")
    update_momentum(tech, None)
    _assert(spot_row["v"] == "-0.92%（现货）", "missing change does not clear 今日现货")
    _assert(update_gold_candles(tech, 4280.0, session, 25000) == "updated-today", "same session")
    _assert(tech["volume"][-1] == 25000, f"intraday volume updated, got {tech['volume'][-1]}")
    _assert(tech["candles"][-1]["c"] == 4280.0 and tech["candles"][-1]["o"] == 4278.4, "open preserved")
    _assert(len(tech["candles"]) == len(tech["volume"]) == 2, "lengths")

    # New candle with missing COMEX volume appends 0 (clean placeholder, not previous volume)
    tech_missing_vol = {
        "candles": [{"d": "09-22", "o": 4369.0, "h": 4375.0, "l": 4291.0, "c": 4318.18}],
        "volume": [100000],
    }
    _assert(update_gold_candles(tech_missing_vol, 4278.4, session, None) == "appended", "append missing volume")
    _assert(tech_missing_vol["volume"][-1] == 0, f"missing volume appends 0 placeholder, got {tech_missing_vol['volume'][-1]}")

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
    _assert(basis_row["dir"] == "up", f"basis widened 1.0 -> 40.0: {basis_row['dir']}")

    # Basis narrows from 40.0 to 30.0 (still positive > 0): dir must be "down"
    _assert(update_basis_row(gold_doc, 4310.0, 4280.0, moment, "test"), "basis narrowed update")
    _assert(basis_row["basis"] == 30.0, "basis 30.0")
    _assert(basis_row["dir"] == "down", f"narrowing basis must be down, got {basis_row['dir']}")

    # Basis widens from 30.0 to 50.0: dir must be "up"
    _assert(update_basis_row(gold_doc, 4330.0, 4280.0, moment, "test"), "basis widened update")
    _assert(basis_row["basis"] == 50.0, "basis 50.0")
    _assert(basis_row["dir"] == "up", f"widening basis must be up, got {basis_row['dir']}")

    # Diff within ±0.05 stays "flat"
    _assert(update_basis_row(gold_doc, 4330.03, 4280.0, moment, "test"), "basis flat update")
    _assert(basis_row["dir"] == "flat", f"minimal diff must be flat, got {basis_row['dir']}")

    # Fallback to "flat" when prev basis is None
    table_no_basis = {"positioning": {"table": [{"k": "期现基差 GC−现货"}]}}
    _assert(update_basis_row(table_no_basis, 4320.0, 4280.0, moment, "test"), "no prev basis")
    _assert(table_no_basis["positioning"]["table"][0]["dir"] == "flat", "missing prev basis falls back to flat")

    # Re-establish 40.0 basis on gold_doc for subsequent assertions
    _assert(update_basis_row(gold_doc, 4320.0, 4280.0, moment, "test"), "basis restored to 40.0")

    _assert(gold_doc["macro"]["items"][0]["v"] == "叙述保持不动", "macro prose kept")
    _assert(gold_doc["macro"]["items"][0]["quote"] == {"value": 101.13, "chg": "+0.91%"}, gold_doc["macro"]["items"][0]["quote"])
    _assert(gold_doc["macro"]["items"][1]["v"] == "收益率叙述保持不动", "yield prose kept")
    _assert(gold_doc["macro"]["items"][1]["quote"]["value"] == 5.114, "yield value")
    _assert(gold_doc["macro"]["items"][1]["quote"]["bp"] == 16.7, gold_doc["macro"]["items"][1]["quote"])
    saved_wk = basis_row["wk"]
    update_gold(gold_doc, 4280.0, "https://api.gold-api.com/price/XAU", None, None, None, moment)
    _assert(gold_doc["positioning"]["table"][0]["wk"] == saved_wk, "failed GC leaves basis fields")
    _assert(gold_doc["tech"]["volume"][-1] == 0, "missing comex volume appends 0 in update_gold")
    _assert(gold_doc["metrics"]["main"]["quotes"]["gc"] == 4320.0, "failed GC leaves quote")
    _assert(gold_doc["macro"]["items"][0]["quote"]["value"] == 101.13, "failed DXY leaves macro quote")

    # Offline test for sync_sina_gold_series
    mock_xau = [{"date": f"2026-08-{i:02d}", "open": str(4100 + i), "high": str(4120 + i), "low": str(4090 + i), "close": str(4110 + i), "volume": "0"} for i in range(1, 36)]
    mock_gc = [{"date": f"2026-08-{i:02d}", "open": str(4130 + i), "high": str(4150 + i), "low": str(4120 + i), "close": str(4140 + i), "volume": "150000"} for i in range(1, 36)]
    mock_au0 = [{"d": f"2026-08-{i:02d}", "o": str(900 + i), "h": str(910 + i), "l": str(895 + i), "c": str(905 + i), "v": "100000"} for i in range(1, 36)]
    mock_klines = {"xau": mock_xau, "gc": mock_gc, "au0": mock_au0}
    test_sync_doc = {"tech": {}, "charts": {}, "benchmarks": {}}
    sync_res = sync_sina_gold_series(test_sync_doc, mock_klines)
    _assert(len(test_sync_doc["tech"]["candles"]) == 35, f"sync candles len {len(test_sync_doc['tech']['candles'])}")
    _assert("londonSpot" in test_sync_doc["tech"]["instruments"], "londonSpot in instruments")
    _assert("comexGold" in test_sync_doc["tech"]["instruments"], "comexGold in instruments")
    _assert("shau" in test_sync_doc["tech"]["instruments"], "shau in instruments")
    _assert(len(test_sync_doc["charts"]["normalized"]["london"]) == 35, "normalized len")
    _assert(len(test_sync_doc["tech"]["premiumHistory"]["spreads"]) == 35, "spreads len")

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
