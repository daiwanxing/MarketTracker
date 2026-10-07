#!/usr/bin/env python3
"""Sync Chinese statutory holiday and stock exchange closure calendar from authoritative APIs.

Fetches official holiday and schedule data based on State Council announcements
and derives A-share stock exchange trading days and closure windows.
Outputs a structured, zero-hardcode JSON contract at ``src/data/chinaHolidayCalendar.json``.

Usage:
    python3 scripts/sync_holiday_calendar.py [--year 2026] [--all]
"""

from __future__ import annotations

import argparse
import json
import ssl
import sys
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
CALENDAR_PATH = ROOT / "src" / "data" / "chinaHolidayCalendar.json"
SHANGHAI = ZoneInfo("Asia/Shanghai")
UA = "Mozilla/5.0 (compatible; MarketTrackerHolidaySync/1.0; +https://github.com/daiwanxing/MarketTracker)"


def _ssl_context() -> ssl.SSLContext | None:
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        try:
            return ssl._create_unverified_context()
        except Exception:
            return None


def fetch_year_holidays(year: int) -> dict[str, dict]:
    """Fetch raw holiday data for a specific year from official holiday sync API."""
    url = f"https://timor.tech/api/holiday/year/{year}"
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=10, context=_ssl_context()) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    if payload.get("code") != 0 or "holiday" not in payload:
        raise ValueError(f"Invalid API response for year {year}: {payload.get('code')}")
    return payload["holiday"]


def is_weekend(d: date) -> bool:
    return d.weekday() >= 5  # 5: Saturday, 6: Sunday


def build_market_calendar(year: int, raw_holidays: dict[str, dict]) -> dict[str, object]:
    """Derive A-share market trading status for all days in the given year."""
    start_date = date(year, 1, 1)
    end_date = date(year, 12, 31)

    # 1. 整理出属于法定假期的日期集合与名称
    # Timor API 中: v.holiday == True 表示放假；v.holiday == False 表示调休补班
    holiday_dates: dict[date, str] = {}
    for _key, item in raw_holidays.items():
        if item.get("holiday") is True and "date" in item:
            try:
                d = date.fromisoformat(item["date"])
                name = item.get("name", "法定节假日")
                holiday_dates[d] = name
            except ValueError:
                pass

    # 2. 聚合成各个假期的连续区间 (Clusters)
    # 只要是相邻连续的放假日期（(d - prev_d).days == 1），即属于同一个市场连休窗口
    sorted_holiday_days = sorted(holiday_dates.keys())
    raw_clusters: list[list[date]] = []
    if sorted_holiday_days:
        curr = [sorted_holiday_days[0]]
        for d in sorted_holiday_days[1:]:
            if (d - curr[-1]).days == 1:
                curr.append(d)
            else:
                raw_clusters.append(curr)
                curr = [d]
        if curr:
            raw_clusters.append(curr)

    # 3. 为每个连续休市窗口命名并推导交易日
    normalized_clusters: list[dict[str, object]] = []
    for c_dates in raw_clusters:
        c_names = [holiday_dates[d] for d in c_dates]
        all_names_str = "".join(c_names)

        # 统一命名规范
        if "国庆" in all_names_str and "中秋" in all_names_str:
            display_name = "中秋节、国庆节长假休市"
            raw_name = "中秋国庆"
        elif "国庆" in all_names_str:
            display_name = "国庆长假休市"
            raw_name = "国庆节"
        elif any(w in all_names_str for w in ("春", "除夕", "初", "年")):
            display_name = "春节长假休市"
            raw_name = "春节"
        elif "劳动" in all_names_str:
            display_name = "劳动节休市"
            raw_name = "劳动节"
        elif "清明" in all_names_str:
            display_name = "清明节休市"
            raw_name = "清明节"
        elif "端午" in all_names_str:
            display_name = "端午节休市"
            raw_name = "端午节"
        elif "中秋" in all_names_str:
            display_name = "中秋节休市"
            raw_name = "中秋节"
        elif "元旦" in all_names_str:
            display_name = "元旦休市"
            raw_name = "元旦"
        else:
            first_name = c_names[0]
            display_name = f"{first_name}休市"
            raw_name = first_name

        # 推导节前最后交易日 (从 start 的前一天倒推，避开周末和其它休市日)
        c_start = c_dates[0]
        probe_prev = c_start - timedelta(days=1)
        while is_weekend(probe_prev) or probe_prev in holiday_dates:
            probe_prev -= timedelta(days=1)
        last_trade_date = probe_prev

        # 推导节后首个开市日 (从 end 的后一天正推，避开周末和其它休市日)
        c_end = c_dates[-1]
        probe_next = c_end + timedelta(days=1)
        while is_weekend(probe_next) or probe_next in holiday_dates:
            probe_next += timedelta(days=1)
        reopen_date = probe_next

        normalized_clusters.append({
            "holidayName": display_name,
            "rawName": raw_name,
            "startDate": c_start.isoformat(),
            "endDate": c_end.isoformat(),
            "totalDays": len(c_dates),
            "lastTradingDate": last_trade_date.isoformat(),
            "reopeningDate": reopen_date.isoformat(),
            "dates": [d.isoformat() for d in c_dates],
        })

    # 3. 构建以日期为 Key 的全天日历字典 (Daily Map)
    day_map: dict[str, object] = {}
    for cluster in normalized_clusters:
        c_dates = [date.fromisoformat(d) for d in cluster["dates"]]
        total_len = len(c_dates)
        for i, d in enumerate(c_dates):
            is_last = (i == total_len - 1)
            day_map[d.isoformat()] = {
                "isHoliday": True,
                "holidayName": cluster["holidayName"],
                "dayIndex": i + 1,
                "totalDays": cluster["totalDays"],
                "isLastDay": is_last,
                "lastTradingDate": cluster["lastTradingDate"],
                "reopeningDate": cluster["reopeningDate"],
            }

    return {
        "year": year,
        "asOf": datetime.now(SHANGHAI).strftime("%Y-%m-%d %H:%M"),
        "source": "State Council Official Holiday Schedule / timor.tech API",
        "holidays": normalized_clusters,
        "days": day_map,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync official Chinese statutory holiday calendar")
    parser.add_argument("--year", type=int, default=None, help="Year to fetch (defaults to current year)")
    args = parser.parse_args()

    now_shanghai = datetime.now(SHANGHAI)
    target_year = args.year if args.year else now_shanghai.year

    print(f"INFO: Fetching statutory holiday calendar for year {target_year}...")
    try:
        raw_data = fetch_year_holidays(target_year)
    except Exception as exc:
        print(f"ERROR: Failed to fetch holiday data from API: {exc}")
        # 如果已存在本地契约，不破坏现有文件
        if CALENDAR_PATH.exists():
            print("INFO: Keeping existing chinaHolidayCalendar.json intact.")
            return 0
        return 1

    calendar_doc = build_market_calendar(target_year, raw_data)

    CALENDAR_PATH.parent.mkdir(parents=True, exist_ok=True)
    with CALENDAR_PATH.open("w", encoding="utf-8") as f:
        json.dump(calendar_doc, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(f"SUCCESS: Synchronized {len(calendar_doc['holidays'])} holiday clusters and {len(calendar_doc['days'])} holiday days to {CALENDAR_PATH.relative_to(ROOT)}")
    for h in calendar_doc["holidays"]:
        print(f"  • {h['holidayName']}: {h['startDate']} ~ {h['endDate']} (共{h['totalDays']}天, 节前最后交易日: {h['lastTradingDate']}, 复牌: {h['reopeningDate']})")

    return 0


if __name__ == "__main__":
    sys.exit(main())
