#!/usr/bin/env python3
"""Refresh robotics and embodied AI narrative fields via DeepSeek.

Rewrites non-numerical / qualitative sections in ``src/data/robotData.json``:
- ``timeline``: 具身智能与人形机器人产业大事记 (appends new validated facts, max 18)
- ``catalysts``: 前瞻催化剂与预期差雷达 (rolling 4 key forward-looking events)
- ``optionSentinel.tsla.supplyChainAudit``: 核心零部件送样与定点动态说明

Numerical and structural keys owned by market feeds or manual disclosure tracking
(head, benchmarks, charts.normalized, crowding, anchor.kpis, dimensions)
STAY STRICTLY UNTOUCHED. A failed fetch, invalid JSON or model error leaves
the file completely unmodified.

Sources: Google News RSS (Humanoid Robot / Embodied AI / Supply Chain, last 24h).
Model: DeepSeek ``deepseek-flash`` (DeepSeek-V4.1-Flash) at ``https://api.deepseek.com/chat/completions``.
Key: environment variable ``DS_API_KEY``.
"""

from __future__ import annotations

import argparse
import copy
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
ROBOT_PATH = ROOT / "src" / "data" / "robotData.json"
SHANGHAI = ZoneInfo("Asia/Shanghai")
UA = "Mozilla/5.0 (compatible; MarketTrackerRobotTimeline/1.0; +https://github.com/daiwanxing/MarketTracker)"
DEEPSEEK_URL = "https://api.deepseek.com/chat/completions"
MODEL_NAME = "deepseek-flash"

RSS_QUERIES = (
    # Google News 英文：聚焦全球人形机器人整机、灵巧手与量产 (Optimus / Figure / Unitree / Boston Dynamics)
    "https://news.google.com/rss/search?q=(humanoid+robot+OR+Optimus+OR+Figure+AI+OR+Unitree+OR+Agibot+OR+bipedal)+when:1d&hl=en-US&gl=US&ceid=US:en",
    # Google News 中文：聚焦国内具身智能整机、长三角供应链（丝杠/减速器/电机）与工业产线验证
    "https://news.google.com/rss/search?q=(%E4%BA%BA%E5%BD%A2%E6%9C%BA%E5%99%A8%E4%BA%BA+OR+%E5%85%B7%E8%BA%AB%E6%99%BA%E8%83%BD+OR+%E5%AE%87%E6%A0%91%E7%A7%91%E6%8A%80+OR+%E6%99%BA%E5%85%83%E6%9C%BA%E5%99%A8%E4%BA%BA+OR+%E4%BC%98%E5%BF%85%E9%80%89+OR+%E5%87%8F%E9%80%9F%E5%99%A8+OR+%E6%BB%9A%E6%9F%B1%E4%B8%9D%E6%9D%A0)+when:1d&hl=zh-CN&gl=CN&ceid=CN:zh-Hans",
)

MAX_HEADLINES = 12
MAX_RAW_HEADLINES = 40
MAX_TIMELINE = 18
MAX_AGE_DAYS = 30
TAGS = (
    "制造瓶颈",
    "供应链",
    "产线投产",
    "量产进展",
    "财报披露",
    "一级融资",
    "出货统计",
    "资本上市",
    "技术验证",
    "集采规划",
)
CATALYST_TAGS = ("技术节点", "展会与商业化", "集采招投标", "量产交付")

ROBOT_KEYWORDS = (
    "humanoid", "optimus", "figure", "unitree", "agibot", "ubtech", "dexterous",
    "actuator", "roller screw", "harmonic", "embodied", "bipedal", "robotics",
    "人形机器人", "具身智能", "宇树", "智元", "优必选", "银河通用", "星海图",
    "减速器", "滚柱丝杠", "六维力", "灵巧手", "空心杯", "伺服电机", "带电作业",
)

NOISE_KEYWORDS = (
    "cooking oil", "vacuum", "lawn mower", "pool cleaner", "lego", "toy",
    "扫地机", "扫地机器人", "割草机", "泳池清洁", "玩具", "乐高", "game review", "deal", "discount",
)

SYSTEM_PROMPT = """你是机器人与具身智能行业卖方研究编辑，按彭博终端（Bloomberg Terminal）与顶级投行研报口径更新人形机器人产业观察看板的非数值叙述内容。
输入包含当前盘面定价基准（中证机器人 562500.SH、全球ROBO ETF、特斯拉 TSLA）、成分股成交额占比与微观拥挤度、既有大事记时间轴及 24 小时中英快讯。
只依据这些事实材料，不编造未出现的数字与虚假行情。

【文风与表达禁令】
- 严禁任何自媒体口语与情绪词：突发、暴跌、狂飙、抢购、散户、我们、大家、避坑、焦虑、极端暴涨、割肉、适合买入、继续拿、抄底、抢货。
- 替换为机构专业术语：承压、高位震荡、送样验证、前瞻中枢、机构持仓、市场、保持观察、估值消化、战略备货、供应链锁定、良率爬坡、稼动率。
- 语言风格：冷峻精炼、逻辑严密、事实优先、因果传导闭环。

【输出要求与数据契约】
必须严格输出且仅输出合法 JSON 对象，包含以下字段：
{
  "events": [
    {
      "date": "YYYY-MM-DD",
      "tag": "制造瓶颈 | 供应链 | 产线投产 | 量产进展 | 财报披露 | 一级融资 | 出货统计 | 资本上市 | 技术验证 | 集采规划",
      "hot": false,
      "t": "标题（22-45 字，客观概括核心事实）",
      "d": "正文（90-180 字，阐述技术验证、工位部署、供应链定点或交付进展）",
      "src": "来源：机构或媒体名称",
      "url": "https://..."
    }
  ],
  "catalysts": [
    {
      "date": "YYYY-MM 或 YYYY-QX",
      "tag": "技术节点 | 展会与商业化 | 集采招投标 | 量产交付",
      "title": "事件名称与核心内容（14-35 字）",
      "watch": "重点跟踪验证变量与预期差（20-60 字）"
    }
  ],
  "supplyChainAudit": {
    "screwStatus": "string（丝杠进展最新摘要，30-60字）",
    "handMotorStatus": "string（灵巧手电机进展最新摘要，30-60字）",
    "targetBOM": "$20,000–$30,000 长期整机目标成本"
  }
}
无新事实时 events 为空数组 []；catalysts 必须严格返回 4 个核心前瞻催化剂条目；events 中的 url 必须原样复制输入 headlines 里对应条目的 link，不得改写或自造。"""


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


def http_bytes(
    url: str,
    timeout: int = 15,
    headers: dict[str, str] | None = None,
    data: bytes | None = None,
) -> bytes:
    req_headers = {"User-Agent": UA, "Accept": "application/json,text/xml,application/xml,*/*"}
    if headers:
        req_headers.update(headers)
    req = urllib.request.Request(url, headers=req_headers, data=data)
    with urllib.request.urlopen(req, timeout=timeout, context=_ssl_context()) as resp:
        return resp.read()


def fetch_headlines() -> list[dict[str, str]]:
    headlines: list[dict[str, str]] = []
    seen: set[str] = set()

    for url in RSS_QUERIES:
        try:
            content = http_bytes(url, timeout=12)
            root = ET.fromstring(content)
        except Exception as exc:
            log("WARN", f"RSS query failed: {url} ({exc})")
            continue

        for item in root.findall(".//item"):
            title = (item.findtext("title") or "").strip()
            link = (item.findtext("link") or "").strip()
            pub_date = (item.findtext("pubDate") or "").strip()
            source = (item.findtext("source") or "").strip()
            if not title or not link:
                continue

            # Strip google news source suffix if present
            title_clean = re.sub(r"\s*-\s*[^-]+$", "", title).strip()
            if not title_clean or title_clean.lower() in seen:
                continue
            seen.add(title_clean.lower())

            headlines.append(
                {
                    "title": title_clean,
                    "source": source or "News",
                    "published": pub_date,
                    "link": link,
                }
            )
            if len(headlines) >= MAX_RAW_HEADLINES:
                break
        if len(headlines) >= MAX_RAW_HEADLINES:
            break

    return headlines


def score_headline(item: dict[str, str]) -> int:
    text = f"{item.get('title', '')} {item.get('source', '')}".lower()
    for noise in NOISE_KEYWORDS:
        if noise in text:
            return -100

    score = 0
    for kw in ROBOT_KEYWORDS:
        if kw in text:
            score += 10
    return score


def rank_and_filter_headlines(raw: list[dict[str, str]], max_items: int = MAX_HEADLINES) -> list[dict[str, str]]:
    scored: list[tuple[int, dict[str, str]]] = []
    for h in raw:
        score = score_headline(h)
        if score > 0:
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


def extract_context(doc: dict, headlines: list[dict[str, str]] | None = None) -> dict:
    prior = [
        {"date": item.get("date"), "tag": item.get("tag"), "t": item.get("t")}
        for item in (doc.get("timeline") or [])[:8]
        if isinstance(item, dict)
    ]
    benchmarks = doc.get("benchmarks", {})
    crowding = doc.get("crowding", {})
    turnover = crowding.get("turnoverShare", {})
    option = doc.get("optionSentinel", {}).get("tsla", {})

    return {
        "asOf": datetime.now(SHANGHAI).strftime("%Y-%m-%d %H:%M 上海"),
        "benchmarks": {
            "csRobot": benchmarks.get("csRobot", {}),
            "robo": benchmarks.get("robo", {}),
            "tsla": benchmarks.get("tsla", {}),
        },
        "crowding": {
            "turnoverShare": turnover.get("value"),
            "label": crowding.get("label"),
            "robotAmountYi": turnover.get("robotAmountYi"),
            "marketAmountYi": turnover.get("marketAmountYi"),
        },
        "existing_timeline": prior,
        "existing_catalysts": doc.get("catalysts", []),
        "supplyChainAudit": option.get("supplyChainAudit", {}),
        "headlines": rank_and_filter_headlines(headlines or [], MAX_HEADLINES),
    }


def call_deepseek(context: dict, api_key: str) -> dict:
    body = {
        "model": MODEL_NAME,
        "temperature": 0.2,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": json.dumps(context, ensure_ascii=False)},
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
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices:
        raise ValueError("model response contains empty choices")
    content = choices[0]["message"]["content"]
    parsed = parse_model_json(content)
    if not isinstance(parsed.get("events"), list):
        raise ValueError("model JSON has no events array")
    if not isinstance(parsed.get("catalysts"), list):
        raise ValueError("model JSON missing catalysts")
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
    if not (20 <= len(title) <= 55 and 80 <= len(detail) <= 220 and source.startswith("来源：")):
        return None

    url = raw.get("url") if isinstance(raw.get("url"), str) else ""
    allowed = {row.get("link") for row in headlines or [] if isinstance(row.get("link"), str)}
    if allowed and url not in allowed:
        url = ""
    if url and not url.startswith("https://"):
        url = ""

    event: dict[str, object] = {
        "date": event_date,
        "tag": tag,
        "hot": bool(raw.get("hot", False)),
        "t": title,
        "d": detail,
        "src": source,
    }
    if url:
        event["url"] = url
    return event


def normalize_catalysts(raw: object) -> list[dict] | None:
    if not isinstance(raw, list):
        return None
    rows: list[dict] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        c_date = item.get("date")
        c_tag = item.get("tag")
        c_title = item.get("title")
        c_watch = item.get("watch")
        if not (isinstance(c_date, str) and isinstance(c_tag, str) and isinstance(c_title, str) and isinstance(c_watch, str)):
            continue
        c_date, c_tag, c_title, c_watch = c_date.strip(), c_tag.strip(), c_title.strip(), c_watch.strip()
        if not (3 <= len(c_date) <= 12 and c_tag in CATALYST_TAGS and 10 <= len(c_title) <= 50 and 15 <= len(c_watch) <= 100):
            continue
        rows.append({
            "date": c_date,
            "tag": c_tag,
            "title": c_title,
            "watch": c_watch,
        })
    if len(rows) != 4:
        return None
    return rows


def normalize_supply_chain_audit(raw: object) -> dict | None:
    if not isinstance(raw, dict):
        return None
    screw = raw.get("screwStatus")
    motor = raw.get("handMotorStatus")
    bom = raw.get("targetBOM")
    if not (isinstance(screw, str) and isinstance(motor, str) and isinstance(bom, str)):
        return None
    screw, motor, bom = screw.strip(), motor.strip(), bom.strip()
    if not (15 <= len(screw) <= 100 and 15 <= len(motor) <= 100 and 10 <= len(bom) <= 60):
        return None
    return {
        "screwStatus": screw,
        "handMotorStatus": motor,
        "targetBOM": bom,
    }


def is_duplicate_event(candidate: dict, existing: list[dict]) -> bool:
    c_title = candidate.get("t", "")
    c_url = candidate.get("url", "")
    for e in existing:
        if not isinstance(e, dict):
            continue
        if c_url and e.get("url") == c_url:
            return True
        e_title = e.get("t", "")
        if c_title and e_title and (c_title in e_title or e_title in c_title):
            return True
    return False


def merge_timeline(existing: list[dict], new_events: list[dict], today: date) -> list[dict]:
    cutoff = today - timedelta(days=MAX_AGE_DAYS)
    candidates: list[dict] = []
    for ev in new_events:
        d = _valid_date(ev.get("date"))
        if not d or date.fromisoformat(d) < cutoff:
            continue
        if not is_duplicate_event(ev, existing) and not is_duplicate_event(ev, candidates):
            candidates.append(ev)

    combined = candidates + existing
    combined.sort(key=lambda x: str(x.get("date", "")), reverse=True)
    return combined[:MAX_TIMELINE]


def mock_payload_for_doc(doc: dict, headlines: list[dict[str, str]] | None = None) -> dict:
    url = headlines[0].get("link") if headlines else "https://news.google.com/rss/articles/sample-robot-event"
    today_str = datetime.now(SHANGHAI).strftime("%Y-%m-%d")
    return {
        "events": [
            {
                "date": today_str,
                "tag": "技术验证",
                "hot": False,
                "t": "头部具身智能企业完成新一轮千小时工业连续工位作业验证测试",
                "d": "公开披露显示，国内头部具身智能厂商在汽车零部件制造产线完成第二阶段小批量实测，装配节拍与定位公差达到标杆要求，单班次接管率稳步下降，反映生产场景渗透正由验证阶段走向小规模商用。",
                "src": "来源：行业公开跟踪调研",
                "url": url,
            }
        ],
        "catalysts": [
            {
                "date": "2026-10",
                "tag": "技术节点",
                "title": "特斯拉 Optimus 产线审计与长三角送样验证",
                "watch": "重点跟踪行星滚柱丝杠与灵巧手微型电机高公差送样良率测试进展及正式采购订单 (PO)",
            },
            {
                "date": "2026-11",
                "tag": "展会与商业化",
                "title": "中国国际高新技术成果交易会 · 具身智能专馆",
                "watch": "多机集群协同搬运与真实工厂工位实测工时，验证智能制造与物流场景商用复购意向",
            },
            {
                "date": "2026-12",
                "tag": "集采招投标",
                "title": "国家电网 2026 具身智能第二批次集中采购开标",
                "watch": "500 台人形带电作业机器人与双臂巡检机器人实际中标份额分配与交付验收节点",
            },
            {
                "date": "2027-Q1",
                "tag": "量产交付",
                "title": "Figure AI 与宝马斯帕坦堡工厂第二阶段小批量扩量",
                "watch": "每日 10 小时班次零干预率的跨季度持续性，及 RaaS 服务费商业化闭环成立性",
            },
        ],
        "supplyChainAudit": {
            "screwStatus": "高精度行星滚柱丝杠 C3 级通过送样，外圆磨床批量高一致性攻关中",
            "handMotorStatus": "10-12mm 灵巧手微型电机自动化绕线良率爬坡，等待正式批量 PO 确认",
            "targetBOM": "$20,000–$30,000 长期整机目标成本",
        },
    }


def refresh(
    path: Path = ROBOT_PATH,
    api_key: str | None = None,
    dry_run: bool = False,
    headlines: list[dict[str, str]] | None = None,
    model_payload: dict | None = None,
) -> int:
    try:
        with open(path, "r", encoding="utf-8") as f:
            doc = json.load(f)
    except Exception as exc:
        log("ERROR", f"failed to read {path}: {exc}")
        return 1

    timeline = doc.get("timeline")
    if not isinstance(timeline, list):
        log("ERROR", f"{path.name} missing timeline list")
        return 1

    try:
        rows = headlines if headlines is not None else fetch_headlines()
    except Exception as exc:
        if dry_run:
            log("INFO", f"headline fetch failed in dry-run ({exc}); using mock headline")
            rows = [
                {
                    "title": "Humanoid robot factory deployment milestones announced",
                    "source": "Reuters",
                    "published": "Mon, 28 Sep 2026 00:00:00 GMT",
                    "link": "https://news.google.com/rss/articles/sample-robot-event",
                }
            ]
        else:
            log("WARN", f"headline fetch failed; timeline left unchanged: {exc}")
            return 0

    if not rows:
        if dry_run:
            log("INFO", "no headlines found in dry-run; using mock headline")
            rows = [
                {
                    "title": "Humanoid robot factory deployment milestones announced",
                    "source": "Reuters",
                    "published": "Mon, 28 Sep 2026 00:00:00 GMT",
                    "link": "https://news.google.com/rss/articles/sample-robot-event",
                }
            ]
        else:
            log("WARN", "no headlines; timeline left unchanged")
            return 0

    log("INFO", f"fetched {len(rows)} headlines")
    context = extract_context(doc, rows)

    try:
        if model_payload is None:
            key = api_key if api_key is not None else os.environ.get("DS_API_KEY", "")
            if not key:
                if dry_run:
                    log("INFO", "DS_API_KEY missing in dry-run mode; using mock payload")
                    payload = mock_payload_for_doc(doc, rows)
                else:
                    log("WARN", "DS_API_KEY missing; narrative left unchanged")
                    return 0
            else:
                payload = call_deepseek(context, key)
        else:
            payload = model_payload
    except Exception as exc:
        log("WARN", f"model call failed; narrative left unchanged: {exc}")
        return 0

    events = [item for item in (normalize_event(row, rows) for row in payload.get("events", [])) if item]
    catalysts = normalize_catalysts(payload.get("catalysts"))
    audit_update = normalize_supply_chain_audit(payload.get("supplyChainAudit"))

    if catalysts is None:
        log("WARN", "catalysts failed validation; narrative left unchanged")
        return 0

    now_shanghai = datetime.now(SHANGHAI)
    merged_timeline = merge_timeline(timeline, events, now_shanghai.date()) if events else timeline

    # Check whether optionSentinel needs update
    existing_option = doc.get("optionSentinel", {}).get("tsla", {})
    existing_audit = existing_option.get("supplyChainAudit")
    audit_changed = False
    if audit_update and audit_update != existing_audit:
        existing_option["supplyChainAudit"] = audit_update
        audit_changed = True

    timeline_changed = merged_timeline != timeline
    catalysts_changed = catalysts != doc.get("catalysts")

    changed = timeline_changed or catalysts_changed or audit_changed
    if not changed:
        log("INFO", "robot narrative unchanged")
        return 0

    doc["timeline"] = merged_timeline
    doc["catalysts"] = catalysts
    log("INFO", f"robot narrative updated: events accepted={len(events)}, kept={len(merged_timeline)}, catalysts updated" + (" (supplyChainAudit updated)" if audit_changed else ""))

    if dry_run:
        log("INFO", f"dry-run: {path.name} not written")
        return 0

    # Atomic write via tempfile
    try:
        dirpath = path.parent
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=dirpath, delete=False) as tmp:
            json.dump(doc, tmp, ensure_ascii=False, indent=2)
            tmp.write("\n")
            tmp_name = tmp.name
        os.replace(tmp_name, path)
        log("INFO", f"successfully updated {path.name}")
        return 0
    except Exception as exc:
        log("ERROR", f"failed to write {path}: {exc}")
        return 1


def run_self_test() -> int:
    log("INFO", "running robotics timeline self-test...")
    with open(ROBOT_PATH, "r", encoding="utf-8") as f:
        doc = json.load(f)

    # 1. Test context extraction
    mock_headline = [
        {
            "title": "Optimus Gen 3 supply chain audit enters Yangtze River Delta",
            "source": "TrendForce",
            "published": "Fri, 02 Oct 2026 12:00:00 GMT",
            "link": "https://news.google.com/rss/articles/sample-optimus-audit",
        }
    ]
    ctx = extract_context(doc, mock_headline)
    assert "benchmarks" in ctx
    assert "csRobot" in ctx["benchmarks"]
    assert "crowding" in ctx
    assert len(ctx["headlines"]) == 1

    # 2. Test event normalization & validation
    sample_raw_event = {
        "date": "2026-10-02",
        "tag": "供应链",
        "hot": True,
        "t": "特斯拉工程团队在华启动新一轮机器人精密关节供应商量产能力审计",
        "d": "产业调研通报显示，特斯拉针对 Optimus 关键关节环节供应商的海外建厂能力与百万台降本可行性展开多维度评审，重点评估高公差丝杠与灵巧手模组一致性良率，为 2 万美元整机目标做前置储备。",
        "src": "来源：公开产业调研通报",
        "url": "https://news.google.com/rss/articles/sample-optimus-audit",
    }
    norm_event = normalize_event(sample_raw_event, mock_headline)
    assert norm_event is not None
    assert norm_event["tag"] == "供应链"

    # 3. Test mock payload execution with dry-run
    payload = mock_payload_for_doc(doc, mock_headline)
    ret = refresh(path=ROBOT_PATH, dry_run=True, headlines=mock_headline, model_payload=payload)
    assert ret == 0

    log("INFO", "robotics timeline self-test passed successfully!")
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description="Refresh robotics narrative via DeepSeek")
    parser.add_argument("--dry-run", action="store_true", help="Fetch and analyze without writing to robotData.json")
    parser.add_argument("--self-test", action="store_true", help="Run offline unit test with fixtures")
    args = parser.parse_args()

    if args.self_test:
        sys.exit(run_self_test())

    sys.exit(refresh(dry_run=args.dry_run))


if __name__ == "__main__":
    main()
