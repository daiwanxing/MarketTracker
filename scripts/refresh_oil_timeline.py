#!/usr/bin/env python3
"""Refresh oil narrative from public headlines via DeepSeek.

Rewrites ``timeline``, ``signal``, and ``risks`` on ``src/data/oilData.json``.
Numeric keys owned by ``scripts/refresh_market_data.py`` (snapshot, metrics,
charts) stay untouched. A failed fetch or model call leaves the file unchanged.

Sources: Google News RSS (English + Chinese crude/Brent queries, last 24h).
Model: DeepSeek ``deepseek-flash`` (DeepSeek-V4.1-Flash) at ``https://api.deepseek.com``.
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
MAX_HEADLINES = 12
MAX_RAW_HEADLINES = 40
MAX_TIMELINE = 18
MAX_AGE_DAYS = 30
TAGS = ("隔夜", "亚盘", "美盘", "EIA", "OPEC+", "海峡", "谈判", "库存", "供应")

OIL_KEYWORDS = (
    "opec", "eia", "api", "iea", "inventory", "库存", "pipeline", "管道",
    "strait", "hormuz", "海峡", "crude", "原油", "brent", "布伦特", "wti",
    "refinery", "炼厂", "炼油", "saudi", "沙特", "russia", "俄罗斯", "iran", "伊朗",
    "sanctions", "制裁", "spr", "战略储备", "production", "减产", "增产",
    "export", "出口", "tanker", "油轮", "石油",
)
NOISE_KEYWORDS = (
    "cooking oil", "vegetable oil", "olive oil", "hair oil", "essential oil",
    "palm oil", "gas prices at pump", "gas station", "corn oil",
)

SYSTEM_PROMPT = """你是大宗商品卖方研究编辑，按 Bloomberg / 投行研报口径更新原油看板。
输入含最新报价、已有时间轴和 24 小时快讯。只依据这些材料，不编造未出现的数字。
禁止口语与情绪词：突发、暴跌、狂飙、抢购、散户、我们、大家、避坑、焦虑、极端暴涨。
时间轴 events：只收录对供需、库存、航运或政策有实质增量的事实，最多 2 条。
无新事实时 events 为空数组，但仍须按当前报价和已有时间轴重写 signal 与 risks。
每条 event 的 url 必须原样复制输入 headlines 里对应条目的 link，不得改写或留空。
tag 只能从这些里选：隔夜、亚盘、美盘、EIA、OPEC+、海峡、谈判、库存、供应。
hot 仅在事件改变供应路径或政策预期时为 true。
标题 t 25–40 字，正文 d 120–180 字。src 以「来源：」开头。
signal.verdict 一句说清当前主矛盾，并引用 quote 里的 BZ=F、涨跌和 WTI。
signal.sub 说明口径（BZ=F 不是通讯社近月合约）以及报价与事件如何对应。
signal.bull 与 signal.bear 各 3 条，dim 只能是 geo、supply、stocks、macro。
signal.watch 用「 · 」连接 4–6 个待核实变量。
risks 恰好 3 条，level 只能是 r、a、g。k 是变量名，desc 写触发条件与价格含义，src 点名来源。
只输出 JSON：
{"events":[{"date":"YYYY-MM-DD","tag":"...","hot":false,"t":"...","d":"...","src":"...","url":"https://..."}],
"signal":{"verdict":"...","sub":"...","bull":[{"dim":"geo","k":"...","v":"..."}],"bear":[{"dim":"macro","k":"...","v":"..."}],"watch":"..."},
"risks":[{"k":"...","level":"a","desc":"...","src":"..."}]}"""


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
            if len(rows) >= MAX_RAW_HEADLINES:
                return rows
    return rows


def rank_and_filter_headlines(headlines: list[dict[str, str]], max_items: int = MAX_HEADLINES) -> list[dict[str, str]]:
    if not headlines:
        return []
    scored: list[tuple[int, dict[str, str]]] = []
    for h in headlines:
        title = (h.get("title") or "").lower()
        source = (h.get("source") or "").lower()
        score = 0
        for kw in OIL_KEYWORDS:
            if kw in title:
                score += 3
        if any(s in source for s in ("reuters", "bloomberg", "wsj", "cnbc", "oilprice", "platts", "argus")):
            score += 2
        for noise in NOISE_KEYWORDS:
            if noise in title:
                score -= 6
        scored.append((score, h))

    scored.sort(key=lambda x: x[0], reverse=True)
    selected: list[dict[str, str]] = []
    for _, item in scored[:max_items]:
        selected.append(
            {
                "title": item.get("title", "").strip(),
                "source": item.get("source", "").strip(),
                "link": item.get("link", "").strip(),
            }
        )
    return selected


def parse_model_json(text: str) -> dict:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    payload = json.loads(cleaned)
    if not isinstance(payload, dict):
        raise ValueError("model payload is not an object")
    return payload


def call_deepseek(
    headlines: list[dict[str, str]],
    existing: list[dict],
    quote: dict,
    api_key: str,
) -> dict:
    prior = [
        {"date": item.get("date"), "tag": item.get("tag"), "t": item.get("t")}
        for item in existing[:8]
        if isinstance(item, dict)
    ]
    user = {
        "asOf": datetime.now(SHANGHAI).strftime("%Y-%m-%d %H:%M 上海"),
        "quote": quote,
        "existing_timeline": prior,
        "headlines": rank_and_filter_headlines(headlines, MAX_HEADLINES),
    }
    body = {
        "model": "deepseek-flash",
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
    if not isinstance(parsed.get("events"), list):
        raise ValueError("model JSON has no events array")
    if not isinstance(parsed.get("signal"), dict) or not isinstance(parsed.get("risks"), list):
        raise ValueError("model JSON missing signal or risks")
    return parsed


def _valid_date(value: object) -> str | None:
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return None
    try:
        date.fromisoformat(value)
    except ValueError:
        return None
    return value


def normalize_event(raw: object, headlines: list[dict[str, str]] | None = None) -> dict | None:
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
    url = raw.get("url") if isinstance(raw.get("url"), str) else ""
    allowed = {row.get("link") for row in headlines or [] if isinstance(row.get("link"), str)}
    if allowed and url not in allowed:
        url = ""
    if url and not url.startswith("https://"):
        url = ""
    event = {
        "date": event_date,
        "tag": tag,
        "hot": bool(raw.get("hot")),
        "t": title,
        "d": detail,
        "src": source,
    }
    if url:
        event["url"] = url
    return event


def _factor(raw: object) -> dict | None:
    if not isinstance(raw, dict):
        return None
    dim = raw.get("dim")
    key = raw.get("k")
    value = raw.get("v")
    if dim not in ("geo", "supply", "stocks", "macro"):
        return None
    if not isinstance(key, str) or not isinstance(value, str):
        return None
    key, value = key.strip(), value.strip()
    if not (4 <= len(key) <= 40 and 12 <= len(value) <= 160):
        return None
    return {"dim": dim, "k": key, "v": value}


def normalize_signal(raw: object) -> dict | None:
    if not isinstance(raw, dict):
        return None
    verdict = raw.get("verdict")
    sub = raw.get("sub")
    watch = raw.get("watch")
    bull = raw.get("bull")
    bear = raw.get("bear")
    if not all(isinstance(item, str) for item in (verdict, sub, watch)):
        return None
    if not isinstance(bull, list) or not isinstance(bear, list):
        return None
    bull_rows = [row for row in (_factor(item) for item in bull) if row]
    bear_rows = [row for row in (_factor(item) for item in bear) if row]
    if len(bull_rows) < 3 or len(bear_rows) < 3:
        return None
    return {
        "secTitle": "市场信号",
        "verdict": verdict.strip(),
        "sub": sub.strip(),
        "bullTitle": "利多因素",
        "bullHint": "指向抬升",
        "bull": bull_rows[:3],
        "bearTitle": "利空因素",
        "bearHint": "指向回落",
        "bear": bear_rows[:3],
        "watch": watch.strip(),
    }


def normalize_risks(raw: object) -> list[dict] | None:
    if not isinstance(raw, list):
        return None
    rows: list[dict] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        level = item.get("level")
        key = item.get("k")
        desc = item.get("desc")
        source = item.get("src")
        if level not in ("r", "a", "g"):
            continue
        if not all(isinstance(value, str) for value in (key, desc, source)):
            continue
        key, desc, source = key.strip(), desc.strip(), source.strip()
        if not (4 <= len(key) <= 40 and 20 <= len(desc) <= 240 and 4 <= len(source) <= 80):
            continue
        rows.append({"k": key, "level": level, "desc": desc, "src": source})
    return rows[:3] if len(rows) >= 3 else None


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


def quote_context(doc: dict) -> dict:
    main = doc.get("metrics", {}).get("main", {})
    quotes = main.get("quotes") if isinstance(main.get("quotes"), dict) else {}
    return {
        "asOf": doc.get("snapshot"),
        "brent": main.get("num"),
        "change": main.get("chg"),
        "src": main.get("src"),
        "wti": quotes.get("wti"),
        "dxy": quotes.get("dxy"),
    }


def refresh_oil_timeline(
    dry_run: bool = False,
    data_path: Path | None = None,
    headlines: list[dict[str, str]] | None = None,
    model_payload: dict | None = None,
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
        if model_payload is None:
            key = api_key if api_key is not None else os.environ.get("DS_API_KEY", "")
            if not key:
                log("WARN", "DS_API_KEY missing; narrative left unchanged")
                return 0
            payload = call_deepseek(rows, timeline, quote_context(doc), key)
        else:
            payload = model_payload
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, KeyError, ValueError, OSError) as exc:
        log("WARN", f"model call failed; narrative left unchanged: {exc}")
        return 0

    events = [item for item in (normalize_event(row, rows) for row in payload.get("events", [])) if item]
    signal = normalize_signal(payload.get("signal"))
    risks = normalize_risks(payload.get("risks"))
    if signal is None or risks is None:
        log("WARN", "signal or risks failed validation; narrative left unchanged")
        return 0

    merged = merge_timeline(timeline, events, datetime.now(SHANGHAI).date()) if events else timeline
    changed = merged != timeline or signal != doc.get("signal") or risks != doc.get("risks")
    if not changed:
        log("INFO", "narrative unchanged")
        return 0
    doc["timeline"] = merged
    doc["signal"] = signal
    doc["risks"] = risks
    doc["risksTitle"] = "原油市场观察变量"
    log("INFO", f"timeline accepted={len(events)} kept={len(merged)}; signal and risks updated")

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
            "url": "https://example.com/opec",
        },
        [{"title": "OPEC", "link": "https://example.com/opec"}],
    )
    _assert(good is not None and good["url"] == "https://example.com/opec", "valid event")
    _assert(normalize_event({"date": "09-28", "tag": "OPEC+", "t": "短", "d": "短", "src": "路透"}) is None, "reject bad shape")
    _assert(normalize_event({**good, "tag": "突发"}) is None, "reject unknown tag")
    rejected_url = normalize_event({**good, "url": "https://evil.example/story"}, [{"link": "https://example.com/opec"}])
    _assert(rejected_url is not None and "url" not in rejected_url, "drop unknown url")

    signal = normalize_signal({
        "verdict": "供应约束仍在，报价回落反映谈判预期而非库存反转。",
        "sub": "面板主价为 Yahoo BZ=F，与通讯社近月合约不是同一代码。",
        "bull": [
            {"dim": "geo", "k": "海峡通行仍受限制", "v": "商船通行数量低于战前，供应路径没有完全恢复。"},
            {"dim": "supply", "k": "OPEC+ 未增加供应", "v": "现行产量安排维持，没有新增增产对冲地缘缺口。"},
            {"dim": "stocks", "k": "馏分油库存偏紧", "v": "成品油库存下降，炼厂开工回落限制成品油供应。"},
        ],
        "bear": [
            {"dim": "geo", "k": "谈判仍在进行", "v": "双方仍在交换条件，外交通道没有关闭。"},
            {"dim": "supply", "k": "绕行货量维持", "v": "海峡以外交割继续补充一部分现货。"},
            {"dim": "macro", "k": "美元与利率偏强", "v": "美元指数与美债收益率抬升，压制远期需求预期。"},
        ],
        "watch": "海峡通行量 · OPEC+ 会议 · EIA 库存 · BZ=F 与近月价差",
    })
    _assert(signal is not None and len(signal["bull"]) == 3, "signal")
    risks = normalize_risks(
        [
            {"k": "霍尔木兹通行", "level": "r", "desc": "通行条件若收紧，现货贴水与运费会同时上升，供应路径重新变成价格主变量。", "src": "路透 9/28"},
            {"k": "炼厂开工", "level": "a", "desc": "开工回落会把原油累库转成成品油紧张，柴油裂解价差随之走阔。", "src": "EIA 9/24"},
            {"k": "美元与利率", "level": "g", "desc": "利率继续上行会压制非商业净多与远期需求，地缘溢价更难维持。", "src": "美债 9/28"},
        ]
    )
    _assert(risks is not None and len(risks) == 3, "risks")

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
            headlines=[{"title": "OPEC+ holds", "source": "Reuters", "published": "", "link": "https://example.com/opec"}],
            model_payload={"events": [good], "signal": signal, "risks": risks},
        )
        _assert(status == 0, "status")
        written = json.loads(test_file.read_text(encoding="utf-8"))
        _assert(written["timeline"][0]["url"] == "https://example.com/opec", "url kept")
        _assert(written["signal"]["verdict"].startswith("供应约束"), "signal written")
        _assert(written["risks"][0]["level"] == "r", "risks written")
        _assert(written["metrics"]["main"]["num"] == "100", "metrics untouched")
        _assert(written["charts"]["dates"] == ["09-28"], "charts untouched")
        empty = refresh_oil_timeline(
            dry_run=True,
            data_path=test_file,
            headlines=[{"title": "noise", "source": "", "published": "", "link": ""}],
            model_payload={"events": [], "signal": signal, "risks": risks},
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
