#!/usr/bin/env python3
"""Append one 588170 (科创半导体ETF华夏) quote snapshot to snapshots.json.

Uses public endpoints that respond from GitHub-hosted runners:
- Eastmoney push2 for the exchange quote (fallback: Tencent, then Sina)
- Tencent for IOPV / 实时参考净值 when that field is present
- Eastmoney fund NAV history for the latest official 单位净值
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

SHANGHAI = ZoneInfo("Asia/Shanghai")
ROOT = Path(__file__).resolve().parent.parent
DATA_PATH = ROOT / "snapshots.json"

CODE = "588170"
NAME = "科创半导体ETF华夏"
FULL_NAME = "华夏上证科创板半导体材料设备主题ETF"

USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
)

EASTMONEY_HOSTS = (
    "https://push2.eastmoney.com",
    "https://82.push2.eastmoney.com",
    "https://push2delay.eastmoney.com",
)
EASTMONEY_FIELDS = "f43,f44,f45,f46,f57,f58,f60,f86,f169,f170"


def classify_session(now: datetime, quote_time: datetime | None) -> str:
    """Label whether this snapshot is a live print or the last available price."""
    if now.tzinfo is None:
        raise ValueError("now must be timezone-aware")
    local = now.astimezone(SHANGHAI)
    if local.weekday() >= 5:
        return "休市（周末）· 非交易时段，记录收盘价"
    minutes = local.hour * 60 + local.minute
    if minutes < 9 * 60 + 30:
        status = "盘前 · 非交易时段，记录最近可得报价"
    elif minutes <= 11 * 60 + 30 or (13 * 60 <= minutes <= 15 * 60):
        status = "交易中"
    elif minutes < 13 * 60:
        status = "午间休市 · 非交易时段，记录最近可得报价"
    else:
        status = "已收盘 · 非交易时段，记录收盘价"
    if (
        status == "交易中"
        and quote_time is not None
        and quote_time.astimezone(SHANGHAI).date() != local.date()
    ):
        return "疑似休市 · 非交易时段，记录最近可得报价"
    return status


def fetch_bytes(url: str, headers: dict[str, str], timeout: int = 20) -> tuple[bytes, str | None]:
    last_error: Exception | None = None
    for _ in range(2):
        request = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.read(), response.headers.get_content_charset()
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            last_error = error
    assert last_error is not None
    raise last_error


def decode_body(raw: bytes, charset: str | None) -> str:
    for encoding in (charset, "utf-8", "gb18030", "gbk"):
        if not encoding:
            continue
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def get_text(url: str, headers: dict[str, str]) -> str:
    raw, charset = fetch_bytes(url, headers)
    return decode_body(raw, charset)


def as_float(value: object) -> float | None:
    if value is None:
        return None
    text = str(value).strip()
    if text in {"", "-", "--"}:
        return None
    return float(text)


def round_or_none(value: float | None, digits: int) -> float | None:
    if value is None:
        return None
    return round(value, digits)


def parse_compact_time(value: str) -> datetime | None:
    text = value.strip()
    if len(text) != 14 or not text.isdigit():
        return None
    return datetime.strptime(text, "%Y%m%d%H%M%S").replace(tzinfo=SHANGHAI)


def quote_from_parts(
    *,
    source: str,
    price: float | None,
    prev_close: float | None,
    open_price: float | None,
    high: float | None,
    low: float | None,
    change_amt: float | None,
    change_pct: float | None,
    quote_time: datetime | None,
    iopv: float | None = None,
    nav_hint: float | None = None,
) -> dict:
    if price is None or price <= 0:
        raise ValueError(f"{source} quote has no latest price")
    if change_amt is None and prev_close is not None:
        change_amt = price - prev_close
    if change_pct is None and prev_close not in (None, 0) and change_amt is not None:
        change_pct = change_amt / prev_close * 100
    return {
        "source": source,
        "price": price,
        "prev_close": prev_close,
        "open": open_price,
        "high": high,
        "low": low,
        "change_amt": change_amt,
        "change_pct": change_pct,
        "quote_time": quote_time,
        "iopv": iopv,
        "nav_hint": nav_hint,
    }


def fetch_eastmoney_quote() -> dict:
    headers = {
        "User-Agent": USER_AGENT,
        "Referer": "https://quote.eastmoney.com/sh588170.html",
        "Accept": "application/json,text/plain,*/*",
    }
    errors: list[str] = []
    for host in EASTMONEY_HOSTS:
        url = (
            f"{host}/api/qt/stock/get?fltt=2&invt=2&secid=1.{CODE}"
            f"&fields={EASTMONEY_FIELDS}"
        )
        try:
            payload = json.loads(get_text(url, headers))
        except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError, ValueError) as error:
            errors.append(f"{host}: {error}")
            continue
        data = payload.get("data") or {}
        if payload.get("rc") not in (0, None) or as_float(data.get("f43")) is None:
            errors.append(f"{host}: empty quote")
            continue
        quote_time = None
        if data.get("f86") not in (None, "", "-"):
            quote_time = datetime.fromtimestamp(int(data["f86"]), SHANGHAI)
        return quote_from_parts(
            source="eastmoney",
            price=as_float(data.get("f43")),
            prev_close=as_float(data.get("f60")),
            open_price=as_float(data.get("f46")),
            high=as_float(data.get("f44")),
            low=as_float(data.get("f45")),
            change_amt=as_float(data.get("f169")),
            change_pct=as_float(data.get("f170")),
            quote_time=quote_time,
        )
    raise RuntimeError("Eastmoney quote failed: " + "; ".join(errors))


def parse_tencent(text: str) -> dict:
    if '="' not in text:
        raise ValueError("unexpected Tencent payload")
    body = text.split('="', 1)[1].rsplit('"', 1)[0]
    parts = body.split("~")
    if len(parts) < 35 or parts[2] != CODE:
        raise ValueError("Tencent payload is missing 588170 fields")

    def at(index: int) -> str:
        return parts[index].strip() if index < len(parts) else ""

    return quote_from_parts(
        source="tencent",
        price=as_float(at(3)),
        prev_close=as_float(at(4)),
        open_price=as_float(at(5)),
        high=as_float(at(33)),
        low=as_float(at(34)),
        change_amt=as_float(at(31)),
        change_pct=as_float(at(32)),
        quote_time=parse_compact_time(at(30)),
        iopv=as_float(at(78)),
        nav_hint=as_float(at(81)),
    )


def fetch_tencent_quote() -> dict:
    text = get_text(
        f"https://qt.gtimg.cn/q=sh{CODE}",
        {"User-Agent": USER_AGENT, "Referer": "https://gu.qq.com/", "Accept": "*/*"},
    )
    return parse_tencent(text)


def parse_sina(text: str) -> dict:
    if '="' not in text:
        raise ValueError("unexpected Sina payload")
    body = text.split('="', 1)[1].rsplit('"', 1)[0]
    parts = [part.strip() for part in body.split(",")]
    if len(parts) < 32:
        raise ValueError("Sina payload is too short")
    price = as_float(parts[3])
    prev_close = as_float(parts[2])
    quote_time = None
    if parts[30] and parts[31]:
        quote_time = datetime.strptime(
            f"{parts[30]} {parts[31]}", "%Y-%m-%d %H:%M:%S"
        ).replace(tzinfo=SHANGHAI)
    return quote_from_parts(
        source="sina",
        price=price,
        prev_close=prev_close,
        open_price=as_float(parts[1]),
        high=as_float(parts[4]),
        low=as_float(parts[5]),
        change_amt=None,
        change_pct=None,
        quote_time=quote_time,
    )


def fetch_sina_quote() -> dict:
    text = get_text(
        f"https://hq.sinajs.cn/list=sh{CODE}",
        {
            "User-Agent": USER_AGENT,
            "Referer": "https://finance.sina.com.cn/",
            "Accept": "*/*",
        },
    )
    return parse_sina(text)


def fetch_quote() -> dict:
    errors: list[str] = []
    for fetcher in (fetch_eastmoney_quote, fetch_tencent_quote, fetch_sina_quote):
        try:
            return fetcher()
        except (urllib.error.URLError, TimeoutError, OSError, ValueError, RuntimeError, json.JSONDecodeError) as error:
            errors.append(f"{fetcher.__name__}: {error}")
    raise RuntimeError("All quote sources failed: " + " | ".join(errors))


def fetch_tencent_extra() -> dict | None:
    try:
        return fetch_tencent_quote()
    except (urllib.error.URLError, TimeoutError, OSError, ValueError, RuntimeError):
        return None


def fetch_official_nav() -> dict | None:
    url = (
        "https://api.fund.eastmoney.com/f10/lsjz"
        f"?fundCode={CODE}&pageIndex=1&pageSize=1"
    )
    headers = {
        "User-Agent": USER_AGENT,
        "Referer": f"https://fundf10.eastmoney.com/jjjz_{CODE}.html",
        "Accept": "application/json,text/plain,*/*",
    }
    try:
        payload = json.loads(get_text(url, headers))
    except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError, ValueError):
        return None
    if payload.get("ErrCode") not in (0, None):
        return None
    rows = ((payload.get("Data") or {}).get("LSJZList")) or []
    if not rows:
        return None
    latest = rows[0]
    nav = as_float(latest.get("DWJZ"))
    if nav is None:
        return None
    return {
        "nav": nav,
        "nav_date": latest.get("FSRQ") or None,
        "nav_change_pct": as_float(latest.get("JZZZL")),
    }


def build_snapshot(now: datetime) -> dict:
    quote = fetch_quote()
    extra = None if quote["source"] == "tencent" else fetch_tencent_extra()
    official_nav = fetch_official_nav()

    iopv = quote.get("iopv")
    if iopv is None and extra is not None:
        iopv = extra.get("iopv")

    nav = None
    nav_date = None
    nav_change_pct = None
    sources = [quote["source"]]
    if official_nav is not None:
        nav = official_nav["nav"]
        nav_date = official_nav["nav_date"]
        nav_change_pct = official_nav["nav_change_pct"]
        sources.append("fund-nav")
    elif quote.get("nav_hint") is not None:
        nav = quote["nav_hint"]
        sources.append("tencent-nav")
    elif extra is not None and extra.get("nav_hint") is not None:
        nav = extra["nav_hint"]
        sources.append("tencent-nav")
    if extra is not None and quote["source"] != "tencent" and extra.get("iopv") is not None:
        sources.append("tencent-iopv")

    price = quote["price"]
    premium_pct = None
    if iopv not in (None, 0):
        premium_pct = (price - iopv) / iopv * 100

    quote_time = quote.get("quote_time")
    return {
        "timestamp": now.astimezone(SHANGHAI).isoformat(timespec="seconds"),
        "quote_time": quote_time.astimezone(SHANGHAI).isoformat(timespec="seconds") if quote_time else None,
        "market_status": classify_session(now, quote_time),
        "price": round_or_none(price, 4),
        "change_amt": round_or_none(quote.get("change_amt"), 4),
        "change_pct": round_or_none(quote.get("change_pct"), 2),
        "prev_close": round_or_none(quote.get("prev_close"), 4),
        "open": round_or_none(quote.get("open"), 4),
        "high": round_or_none(quote.get("high"), 4),
        "low": round_or_none(quote.get("low"), 4),
        "iopv": round_or_none(iopv, 4),
        "premium_pct": round_or_none(premium_pct, 2),
        "nav": round_or_none(nav, 4),
        "nav_date": nav_date,
        "nav_change_pct": round_or_none(nav_change_pct, 2),
        "source": "+".join(sources),
    }


def load_document() -> dict:
    if not DATA_PATH.exists():
        return {"snapshots": []}
    document = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    if not isinstance(document, dict) or not isinstance(document.get("snapshots"), list):
        raise RuntimeError("snapshots.json must be an object with a snapshots array")
    return document


def save_snapshot(snapshot: dict) -> None:
    document = load_document()
    document["code"] = CODE
    document["name"] = NAME
    document["full_name"] = FULL_NAME
    document["exchange"] = "SH"
    document["order"] = "chronological; the page shows newest first"
    document["snapshots"].append(snapshot)
    DATA_PATH.write_text(
        json.dumps(document, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Append one 588170 snapshot.")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the snapshot without writing snapshots.json",
    )
    args = parser.parse_args()
    now = datetime.now(SHANGHAI)
    try:
        snapshot = build_snapshot(now)
    except (urllib.error.URLError, TimeoutError, OSError, ValueError, RuntimeError, json.JSONDecodeError) as error:
        print(f"Failed to record 588170: {error}", file=sys.stderr)
        return 1
    if not args.dry_run:
        save_snapshot(snapshot)
    json.dump(snapshot, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
