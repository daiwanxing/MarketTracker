#!/usr/bin/env python3
"""Refresh oil market timeline narrative from public headlines via DeepSeek.

Only ``timeline`` on ``src/data/oilData.json`` is rewritten. Numeric keys
owned by ``scripts/refresh_market_data.py`` (snapshot, metrics, charts) stay
untouched. Empty model output leaves the file unchanged.

Sources: Google News RSS (English + Chinese crude/Brent queries, last 24h).
Model: DeepSeek ``deepseek-chat`` at ``https://api.deepseek.com``.
Key: environment variable ``DS_API_KEY``.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import ssl
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta
from email.utils import parsedate_to_datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
OIL_PATH = ROOT / "src" / "data" / "oilData.json"
SHANGHAI = ZoneInfo("Asia/Shanghai")
UA = "Mozilla/5.0 (compatible; MarketTrackerOilTimeline/1.0; +https://github.com/daiwanxing/MarketTracker)"
DEEPSEEK_URL = "https://api.deepseek.com/chat/completions"
RSS_QUERIES = (
    "https://news.google.com/rss/search?q=crude+oil+OR+Brent+OR+WTI+when:1d&hl=en-US&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=%E5%8E%9F%E6%B2%B9+OR+%E5%B8%83%E4%BC%A6%E7%89%B9+when:1d&hl=zh-CN&gl=CN&ceid=CN:zh-Hans",
)
MAX_HEADLINES = 40
MAX_TIMELINE = 18
MAX_AGE_DAYS = 30
TAGS = ("隔夜", "亚盘", "美盘", "EIA", "OPEC+", "海峡", "谈判", "库存", "供应")

SYSTEM_PROMPT = """你是大宗商品卖方研究编辑，按 Bloomberg / 投行研报口径写原油时间轴。
只收录对供需、库存、航运或政策有实质增量的事实。价格波动本身、排名图、无新事实的盘面复述不要写。
禁止口语与情绪词：突发、暴跌、狂飙、抢购、散户、我们、大家、避坑、焦虑。
标题 t 控制在 25–40 字，正文 d 控制在 120–180 字，写清事实、来源与对供需或价格的含义。
src 必须写「来源：」并点名报道机构与日期。
tag 只能从这些里选：隔夜、亚盘、美盘、EIA、OPEC+、海峡、谈判、库存、供应。
hot 仅在事件改变供应路径或政策预期时为 true。
若相对已有时间轴没有新事实，events 必须是空数组。
只输出 JSON：{"events":[{"date":"YYYY-MM-DD","tag":"...","hot":false,"t":"...","d":"...","src":"..."}]}"""


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


def http_bytes(url: str, timeout: int = 25, headers: dict[str, str] | None = None, data: bytes | None = None) -> bytes:
    req_headers = {"User-Agent": UA}
    if headers:
        req_headers.update(headers)
    req = urllib.request.Request(url, data=data, headers=req_headers)
    with urllib.request.urlopen(req, timeout=timeout, context=_ssl_context()) as resp:
        return resp.read()


def strip_html(text: str) -> str:
    return re.sub(r"<[^>]+>", "", text or "").strip()


def fetch_headlines(urls: tuple[str, ...] = RSS_QUERIES) -> list[dict[str, str]]:
    seen: set[str] = set()
    rows: list[dict[str, str]] = []
    for url in urls:
        raw = http_bytes(url)
        root = ET.fromstring(raw)
        for item in root.findall(".//item"):
            title = strip_html((item.findtext("title") or "").strip())
            if not title or title in seen:
                continue
            seen.add(title)
            source = item.findtext("source") or ""
            published = item.findtext("pubDate") or ""
            link = item.findtext("link") or ""
            rows.append(
                {
                    "title": title,
                    "source": source.strip(),
                    "published": published.strip(),
                    "link": link.strip(),
                }
            )
            if len(rows) >= MAX_HEADLINES:
                return rows
    return rows


def parse_model_json(text: str) -> dict:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    payload = json.loads(cleaned)
    if not isinstance(payload, dict):
        raise ValueError("model payload is not an object")
    return payload


def call_deepseek(headlines: list[dict[str, str]], existing: list[dict], api_key: str) -> list[dict]:
    prior = [
        {"date": item.get("date"), "tag": item.get("tag"), "t": item.get("t")}
        for item in existing[:8]
        if isinstance(item, dict)
    ]
    user = {
        "today": datetime.now(SHANGHAI).date().isoformat(),
        "existing_timeline": prior,
        "headlines": headlines,
    }
    body = {
        "model": "deepseek-chat",
        "temperature": 0.2,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": json.dumps(user, ensure_ascii=False)},
        ],
    }
    raw = http_bytes(
        DEEPSEEK_URL,
        timeout=60,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        data=json.dumps(body).encode("utf-8"),
    )
    payload = json.loads(raw.decode("utf-8"))
    content = payload["choices"][0]["message"]["content"]
    parsed = parse_model_json(content)
    events = parsed.get("events")
    if not isinstance(events, list):
        raise ValueError("model JSON has no events array")
    return events


def _valid_date(value: object) -> str | None:
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return None
    try:
        date.fromisoformat(value)
    except ValueError:
        return None
    return value


def normalize_event(raw: object) -> dict | None:
    if not isinstance(raw, dict):
        return None
    event_date = _valid_date(raw.get("date"))
    tag = raw.get("tag")
    title = raw.get("t")
    detail = raw.get("d")
    source = raw.get("src")
    if event_date is None or tag not in TAGS:
        return None
    if not isinstance(title, str) or not isinstance(detail, str) or not isinstance(source, str):
        return None
    title = title.strip()
    detail = detail.strip()
    source = source.strip()
    if not (12 <= len(title) <= 80 and 40 <= len(detail) <= 400 and source.startswith("来源：")):
        return None
    return {
        "date": event_date,
        "tag": tag,
        "hot": bool(raw.get("hot")),
        "t": title,
        "d": detail,
        "src": source,
    }


def fingerprint(item: dict) -> str:
    text = f"{item.get('date', '')}|{item.get('t', '')}"
    return re.sub(r"\s+", "", text)


def merge_timeline(existing: list, incoming: list[dict], today: date) -> list[dict]:
    kept: list[dict] = []
    seen: set[str] = set()
    for item in incoming + [row for row in existing if isinstance(row, dict)]:
        key = fingerprint(item)
        if not key or key in seen:
            continue
        event_date = _valid_date(item.get("date"))
        if event_date is None:
            continue
        if date.fromisoformat(event_date) < today - timedelta(days=MAX_AGE_DAYS):
            continue
        seen.add(key)
        kept.append(item)
        if len(kept) >= MAX_TIMELINE:
            break
    return kept


def refresh_oil_timeline(
    dry_run: bool = False,
    data_path: Path | None = None,
    headlines: list[dict[str, str]] | None = None,
    model_events: list | None = None,
    api_key: str | None = None,
) -> int:
    path = OIL_PATH if data_path is None else data_path
    if not path.exists():
        log("ERROR", f"{path} does not exist")
        return 1
    with path.open(encoding="utf-8") as handle:
        doc = json.load(handle)
    timeline = doc.get("timeline")
    if not isinstance(timeline, list):
        log("ERROR", "timeline is missing")
        return 1

    try:
        rows = headlines if headlines is not None else fetch_headlines()
    except (urllib.error.URLError, TimeoutError, ET.ParseError, OSError) as exc:
        log("WARN", f"headline fetch failed; timeline left unchanged: {exc}")
        return 0
    if not rows:
        log("WARN", "no headlines; timeline left unchanged")
        return 0
    log("INFO", f"fetched {len(rows)} headlines")

    try:
        if model_events is None:
            key = api_key if api_key is not None else os.environ.get("DS_API_KEY", "")
            if not key:
                log("WARN", "DS_API_KEY missing; timeline left unchanged")
                return 0
            raw_events = call_deepseek(rows, timeline, key)
        else:
            raw_events = model_events
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, KeyError, ValueError, OSError) as exc:
        log("WARN", f"model call failed; timeline left unchanged: {exc}")
        return 0

    events = [item for item in (normalize_event(row) for row in raw_events) if item is not None]
    if not events:
        log("INFO", "no new timeline events")
        return 0

    merged = merge_timeline(timeline, events, datetime.now(SHANGHAI).date())
    if merged == timeline:
        log("INFO", "timeline unchanged after merge")
        return 0
    doc["timeline"] = merged
    log("INFO", f"timeline events accepted={len(events)} kept={len(merged)}")

    if dry_run:
        log("INFO", "dry-run: oilData.json not written")
        return 0

    with tempfile.NamedTemporaryFile("w", dir=path.parent, delete=False, encoding="utf-8") as tmp:
        json.dump(doc, tmp, ensure_ascii=False, indent=2)
        tmp.write("\n")
        tmp_path = Path(tmp.name)
    tmp_path.replace(path)
    log("INFO", f"wrote {path.name}")
    return 0


def _assert(cond: bool, message: str) -> None:
    if not cond:
        raise AssertionError(message)


def self_test() -> int:
    sample = """
    <rss><channel>
      <item><title>OPEC+ holds October output</title><source>Reuters</source><pubDate>Mon, 28 Sep 2026 00:00:00 GMT</pubDate></item>
      <item><title>OPEC+ holds October output</title><source>Duplicate</source></item>
      <item><title>Desk note &lt;b&gt;ignored&lt;/b&gt;</title></item>
    </channel></rss>
    """
    root = ET.fromstring(sample)
    titles = []
    seen: set[str] = set()
    for item in root.findall(".//item"):
        title = strip_html(item.findtext("title") or "")
        if title in seen:
            continue
        seen.add(title)
        titles.append(title)
    _assert(titles == ["OPEC+ holds October output", "Desk note ignored"], f"rss {titles}")

    good = normalize_event(
        {
            "date": "2026-09-28",
            "tag": "OPEC+",
            "hot": True,
            "t": "OPEC+ 维持 10 月产量不变，供应政策没有新增调整",
            "d": "路透报道七国维持现行产量安排，会议未宣布额外增产或减产。供应路径相对前次声明没有变化，价格影响取决于后续库存与航运数据，而不是产量目标本身的再次重申。",
            "src": "来源：路透（9-28）",
        }
    )
    _assert(good is not None and good["hot"] is True, "valid event")
    _assert(normalize_event({"date": "09-28", "tag": "OPEC+", "t": "短", "d": "短", "src": "路透"}) is None, "reject bad shape")
    _assert(normalize_event({**good, "tag": "突发"}) is None, "reject unknown tag")

    existing = [
        {
            "date": "2026-09-20",
            "tag": "库存",
            "hot": False,
            "t": "既有库存条目保持原标题不被重复写入时间轴",
            "d": "既有正文",
            "src": "来源：EIA",
        }
    ]
    merged = merge_timeline(existing, [good, good], date(2026, 9, 28))
    _assert(len(merged) == 2 and merged[0]["date"] == "2026-09-28", f"merge {merged}")
    stale = {
        "date": "2026-08-01",
        "tag": "供应",
        "hot": False,
        "t": "超过三十天的旧供应事件应当被时间轴裁掉",
        "d": "旧正文超过保留窗口，不应继续留在时间轴数组里占用前端展示位置。",
        "src": "来源：旧稿",
    }
    trimmed = merge_timeline([stale], [], date(2026, 9, 28))
    _assert(trimmed == [], "stale dropped")

    doc = {"timeline": existing, "metrics": {"main": {"num": "100"}}, "charts": {"dates": ["09-28"]}}
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as tmp:
        json.dump(doc, tmp, ensure_ascii=False)
        test_file = Path(tmp.name)
    try:
        status = refresh_oil_timeline(
            dry_run=False,
            data_path=test_file,
            headlines=[{"title": "OPEC+ holds", "source": "Reuters", "published": "", "link": ""}],
            model_events=[good],
        )
        _assert(status == 0, "status")
        written = json.loads(test_file.read_text(encoding="utf-8"))
        _assert(written["timeline"][0]["tag"] == "OPEC+", "prepended")
        _assert(written["metrics"]["main"]["num"] == "100", "metrics untouched")
        _assert(written["charts"]["dates"] == ["09-28"], "charts untouched")
        empty = refresh_oil_timeline(
            dry_run=True,
            data_path=test_file,
            headlines=[{"title": "noise", "source": "", "published": "", "link": ""}],
            model_events=[],
        )
        _assert(empty == 0, "empty events")
        again = json.loads(test_file.read_text(encoding="utf-8"))
        _assert(again["timeline"][0]["tag"] == "OPEC+", "dry-run did not rewrite")
    finally:
        test_file.unlink(missing_ok=True)

    parsed = parsedate_to_datetime("Mon, 28 Sep 2026 00:00:00 GMT")
    _assert(parsed.year == 2026, "pubdate parser available")
    log("INFO", "self-test passed")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Refresh MarketTracker oil timeline narrative.")
    parser.add_argument("--dry-run", action="store_true", help="Fetch and call the model without writing JSON")
    parser.add_argument("--self-test", action="store_true", help="Run offline checks and exit")
    args = parser.parse_args()
    if args.self_test:
        return self_test()
    return refresh_oil_timeline(dry_run=args.dry_run)


if __name__ == "__main__":
    sys.exit(main())
