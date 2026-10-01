#!/usr/bin/env python3
"""Refresh tech semiconductor narrative from headlines and market state via DeepSeek.

Rewrites ``timeline``, ``signal``, and ``risks`` on ``src/data/techSemiData.json``.
Numeric and structural keys owned by ``scripts/refresh_tech_semi_data.py``,
``scripts/refresh_tech_semi_crowding.py``, or manual disclosure tracking
(snapshot, head, benchmarks, charts, crowding, leverage, anomalies, fundamental,
news, footer) stay untouched. A failed fetch or model call leaves the file unchanged.

Sources: Google News RSS (English + Chinese semiconductor queries, last 24h).
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
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
TECH_SEMI_PATH = ROOT / "src" / "data" / "techSemiData.json"
SHANGHAI = ZoneInfo("Asia/Shanghai")
UA = "Mozilla/5.0 (compatible; MarketTrackerTechSemiTimeline/1.0; +https://github.com/daiwanxing/MarketTracker)"
DEEPSEEK_URL = "https://api.deepseek.com/chat/completions"
MODEL_NAME = "deepseek-flash"

RSS_QUERIES = (
    # TrendForce 集邦咨询官方行业洞察（中文半导体一手研判与供需报价）
    "https://www.trendforce.cn/feed/Semiconductors.html",
    # TrendForce Global Market Intelligence (English)
    "https://www.trendforce.com/feed/Semiconductors.html",
    # Google News 英文：聚焦全球先进制程、算力芯片、晶圆代工与封装 (TSMC / ASML / NVIDIA / CoWoS / HBM)
    "https://news.google.com/rss/search?q=(semiconductor+OR+TSMC+OR+ASML+OR+NVIDIA+OR+foundry+OR+CoWoS+OR+HBM)+when:1d&hl=en-US&gl=US&ceid=US:en",
    # Google News 中文：聚焦国内半导体晶圆代工、前道设备自主化与科创板芯片
    "https://news.google.com/rss/search?q=(%E5%8D%8A%E5%AF%BC%E4%BD%93+OR+%E8%8A%AF%E7%89%87+OR+%E7%A7%91%E5%88%9B50+OR+%E5%85%88%E8%BF%9B%E5%88%B6%E7%A8%8B+OR+%E5%85%89%E5%88%BB%E6%9C%BA)+when:1d&hl=zh-CN&gl=CN&ceid=CN:zh-Hans",
)

MAX_HEADLINES = 12
MAX_RAW_HEADLINES = 50
MAX_TIMELINE = 18
MAX_AGE_DAYS = 30
TAGS = ("算力基础设施", "制程产能", "国产替代", "行业周期", "政策监管")
BULL_DIMS = ("capex", "foundry", "substitute")
BEAR_DIMS = ("mature", "geo", "memory")

SEMI_KEYWORDS = (
    "tsmc", "台积电", "asml", "光刻", "foundry", "代工", "制程", "wafer", "晶圆",
    "nvidia", "英伟达", "gpu", "hbm", "cowos", "封装", "packaging", "算力", "csp", "capex", "资本开支",
    "dram", "nand", "nor", "sk hynix", "海力士", "samsung", "三星", "存储", "memory",
    "中芯", "smic", "科创50", "半导体", "芯片", "eda", "mlcc", "自主化", "国产替代",
)
NOISE_KEYWORDS = (
    "game review", "deal", "discount", "playstation", "xbox", "giveaway", "case for", "best price",
    "unboxing", "hands-on", "wallpaper", "smartphone case",
)

SYSTEM_PROMPT = """你是半导体与科技硬件行业卖方研究编辑，按彭博终端（Bloomberg Terminal）与顶级投行研报口径更新科技半导体宏观认知看板。
输入包含当前盘面基准（费城半导体 SOX、韩国KOSPI、科创50）、TMT 成交额占比与拥挤度分区、全市场融资买入强度、四大 CSP 资本开支跟踪、既有时间轴、跨品种宏观数据（原油/美元指数/美债收益率）及 24 小时中英资讯。
只依据这些事实材料，不编造未出现的数字与虚假行情。

【文风与表达禁令】
- 严禁任何自媒体口语与情绪词：突发、暴跌、狂飙、抢购、散户、我们、大家、避坑、焦虑、极端暴涨、割肉、适合买入、继续拿、抄底、接刀、抢芯、囤货。
- 替换为机构专业术语：承压、高位震荡、下行探底、前瞻中枢、机构持仓、市场、保持观察、估值消化、战略备货、供应链锁定、筹码踩踏。
- 语言风格：冷峻精炼、逻辑严密、事实优先、因果传导闭环。

【输出要求与数据契约】
必须严格输出且仅输出合法 JSON 对象，包含以下字段：
{
  "events": [
    {
      "date": "YYYY-MM-DD",
      "tag": "算力基础设施 | 制程产能 | 国产替代 | 行业周期 | 政策监管",
      "hot": false,
      "t": "标题（25-45 字，客观概括核心事实）",
      "d": "正文（100-180 字，阐述产业链影响与边际变化）",
      "src": "来源：机构或媒体名称",
      "url": "https://..."
    }
  ],
  "signal": {
    "verdict": "string（概括当前科技宏观主矛盾，结合价格走势、TMT 成交占比与资本开支）",
    "sub": "string（阐明指标口径边界与观察维度）",
    "bull": [
      { "dim": "capex", "k": "...", "v": "..." },
      { "dim": "foundry", "k": "...", "v": "..." },
      { "dim": "substitute", "k": "...", "v": "..." }
    ],
    "bear": [
      { "dim": "mature", "k": "...", "v": "..." },
      { "dim": "geo", "k": "...", "v": "..." },
      { "dim": "memory", "k": "...", "v": "..." }
    ],
    "watch": "string（以「 · 」连接 3–5 个待观察核心变量）"
  },
  "risks": [
    {
      "k": "变量名称（4-20 字）",
      "level": "high | med | low",
      "desc": "触发条件与产业链影响阐述（20-180 字）",
      "src": "来源标注"
    }
  ],
  "closingReview": {
    "verdict": {
      "headline": "string（收盘定调标题，20-40字，点明核心主矛盾）",
      "coreSummary": "string（深度研判综述，120-220字，必须穿透资金、筹码与宏观因果）",
      "riskTone": "bearish | defensive | neutral | bullish",
      "primaryDriver": "string（核心主导驱动器）"
    },
    "pillars": [
      {
        "id": "crowding",
        "pillarName": "微观筹码与行业拥挤度",
        "pillarNameEn": "MICROSTRUCTURE & CROWDING",
        "weight": 35,
        "impact": "down",
        "impactLabel": "多杀多踩踏",
        "factorTag": "极端过热出清",
        "metrics": [{"label": "TMT成交额占比", "value": "42.17%", "sub": "处 danger 分区"}],
        "transmission": {
          "trigger": "事实触发动因（20-60字）",
          "mechanism": "资金传导机制（30-80字）",
          "outcome": "盘面显性映射（20-60字）"
        },
        "narrative": "研报级精炼阐述（60-120字）"
      },
      {
        "id": "liquidity",
        "pillarName": "资金日历与跨节避险",
        "pillarNameEn": "LIQUIDITY & CALENDAR DE-RISKING",
        "weight": 30,
        "impact": "down",
        "impactLabel": "杠杆防御收缩",
        "factorTag": "长假资金撤退",
        "metrics": [{"label": "节前交易窗口", "value": "T-2 提现日", "sub": "银证转账截止前夕"}],
        "transmission": {"trigger": "...", "mechanism": "...", "outcome": "..."},
        "narrative": "..."
      },
      {
        "id": "macro",
        "pillarName": "宏观利率与商品压制",
        "pillarNameEn": "MACRO YIELDS & COMMODITIES",
        "weight": 20,
        "impact": "down",
        "impactLabel": "折现率抬升",
        "factorTag": "通胀再起预期",
        "metrics": [{"label": "布伦特原油 (BZ=F)", "value": "$100.95/桶", "sub": "站稳百元关口"}],
        "transmission": {"trigger": "...", "mechanism": "...", "outcome": "..."},
        "narrative": "..."
      },
      {
        "id": "industry",
        "pillarName": "产业预期差与基本面",
        "pillarNameEn": "INDUSTRIAL FUNDAMENTALS",
        "weight": 15,
        "impact": "mixed",
        "impactLabel": "结构性预期收敛",
        "factorTag": "K型景气分化",
        "metrics": [{"label": "晶圆代工营收", "value": "$534.9 亿", "sub": "AI满产/消费疲软"}],
        "transmission": {"trigger": "...", "mechanism": "...", "outcome": "..."},
        "narrative": "..."
      }
    ],
    "crossMarket": {
      "spreadMetric": "KC50 vs KOSPI 裂口: -1.36%",
      "spreadStatus": "divergence",
      "divergenceLogic": "阐明为何科创50跌幅显著深于韩国KOSPI（60-120字）",
      "leadLagSignal": "亚太异动对今晚美股开盘的先导预警（50-100字）"
    },
    "nextDayWatch": [
      {
        "target": "观察标的名称",
        "threshold": "临界阈值",
        "logic": "交易含义",
        "priority": "critical | watch"
      }
    ]
  }
}

【边界与细节纪律】
1. events：只收录对半导体产业、产能、需求或供应链有实质增量的事实，最多 2 条。无新增事实时 events 为空数组 []。
2. 每条 event 的 url 必须原样复制输入 headlines 里对应条目的 link，若无对应链接则留空字符串。
3. event.tag 只能选：算力基础设施、制程产能、国产替代、行业周期、政策监管。
4. signal.bull 必须包含 3 条，dim 依次为 capex, foundry, substitute。
5. signal.bear 必须包含 3 条，dim 依次为 mature, geo, memory。
6. risks 必须恰好 3 条，level 必须为 high, med 或 low。
7. closingReview.pillars 必须恰好包含 crowding, liquidity, macro, industry 四大支柱，且四个 weight 之和必须精确等于 100。"""


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
    timeout: int = 25,
    headers: dict[str, str] | None = None,
    data: bytes | None = None,
) -> bytes:
    req_headers = {"User-Agent": UA}
    if headers:
        req_headers.update(headers)
    req = urllib.request.Request(url, data=data, headers=req_headers)
    with urllib.request.urlopen(req, timeout=timeout, context=_ssl_context()) as resp:
        return resp.read()


def strip_html(text: str) -> str:
    return re.sub(r"<[^>]+>", "", text or "").strip()


def parse_model_json(text: str) -> dict:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    payload = json.loads(cleaned)
    if not isinstance(payload, dict):
        raise ValueError("model payload is not an object")
    return payload


def _valid_date(value: object) -> str | None:
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return None
    try:
        date.fromisoformat(value)
    except ValueError:
        return None
    return value


def parse_item_date(item: dict, today: date) -> date | None:
    raw_date = item.get("date")
    if not isinstance(raw_date, str):
        return None
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw_date):
        try:
            return date.fromisoformat(raw_date)
        except ValueError:
            return None
    if re.fullmatch(r"\d{2}-\d{2}", raw_date):
        try:
            d = date.fromisoformat(f"{today.year}-{raw_date}")
            if d > today + timedelta(days=5):
                d = date.fromisoformat(f"{today.year - 1}-{raw_date}")
            return d
        except ValueError:
            return None
    return None


def fingerprint(item: dict, today: date | None = None) -> str:
    raw_date = item.get("date", "")
    norm_date = str(raw_date)
    if today and raw_date:
        parsed = parse_item_date(item, today)
        if parsed:
            norm_date = f"{parsed.month:02d}-{parsed.day:02d}"
    text = f"{norm_date}|{item.get('t', '')}"
    return re.sub(r"\s+", "", text)


def fetch_headlines(urls: tuple[str, ...] = RSS_QUERIES) -> list[dict[str, str]]:
    seen: set[str] = set()
    rows: list[dict[str, str]] = []
    for url in urls:
        try:
            raw = http_bytes(url)
            root = ET.fromstring(raw)
        except Exception as exc:
            log("WARN", f"RSS query failed ({url}): {exc}")
            continue
        for item in root.findall(".//item"):
            title = strip_html((item.findtext("title") or "").strip())
            if not title or title in seen:
                continue
            seen.add(title)
            source = (item.findtext("source") or "").strip()
            if not source and "trendforce" in url.lower():
                source = "TrendForce 集邦咨询"
            published = item.findtext("pubDate") or ""
            link = (item.findtext("link") or "").strip()
            link = link.replace("http://test.new.trendforce.com", "https://www.trendforce.cn")
            rows.append(
                {
                    "title": title,
                    "source": source,
                    "published": published.strip(),
                    "link": link,
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
        for kw in SEMI_KEYWORDS:
            if kw in title:
                score += 3
        if "trendforce" in source or "集邦" in source:
            score += 4
        elif any(news_source in source for news_source in ("reuters", "bloomberg", "wsj", "cnbc")):
            score += 2
        for noise in NOISE_KEYWORDS:
            if noise in title:
                score -= 6
        scored.append((score, h))

    # Highest score first; if tied, keep original order
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


def extract_context(doc: dict, headlines: list[dict[str, str]] | None = None) -> dict:
    benchmarks = doc.get("benchmarks", {})
    sox = benchmarks.get("sox", {})
    star50 = benchmarks.get("star50", {})
    kospi = benchmarks.get("kospi", {})

    crowding = doc.get("crowding", {})
    turnover = crowding.get("turnoverShare", {})

    leverage = doc.get("leverage", {})
    margin = leverage.get("marginBuyShare", {})

    fundamental = doc.get("fundamental", {})
    fund_items = fundamental.get("items", [])
    csp_capex = next(
        (item for item in fund_items if isinstance(item, dict) and item.get("k") == "四大 CSP 资本开支"),
        {},
    )

    existing = doc.get("timeline", [])
    prior = [
        {"date": item.get("date"), "tag": item.get("tag"), "t": item.get("t")}
        for item in (existing[:8] if isinstance(existing, list) else [])
        if isinstance(item, dict)
    ]

    return {
        "asOf": doc.get("snapshot") or datetime.now(SHANGHAI).strftime("%Y-%m-%d %H:%M"),
        "benchmarks": {
            "sox": {
                "name": sox.get("name", "费城半导体指数"),
                "price": sox.get("price"),
                "chg": sox.get("chg"),
                "previousClose": sox.get("previousClose"),
            },
            "kospi": {
                "name": kospi.get("name", "韩国KOSPI指数"),
                "price": kospi.get("price"),
                "chg": kospi.get("chg"),
                "previousClose": kospi.get("previousClose"),
            },
            "star50": {
                "name": star50.get("name", "科创50指数"),
                "price": star50.get("price"),
                "chg": star50.get("chg"),
                "previousClose": star50.get("previousClose"),
            },
        },
        "crowding": {
            "turnoverShare": turnover.get("value"),
            "label": crowding.get("label"),
            "zone": crowding.get("zone"),
            "tmtAmountYi": turnover.get("tmtAmountYi"),
            "marketAmountYi": turnover.get("marketAmountYi"),
        },
        "leverage": {
            "marginBuyShare": margin.get("value"),
            "asOf": margin.get("asOf"),
            "v": margin.get("v"),
        },
        "fundamental": {
            "csp_capex": {
                "status": csp_capex.get("status"),
                "v": csp_capex.get("v"),
                "watch": csp_capex.get("watch"),
            }
        },
        "existing_timeline": prior,
        "headlines": rank_and_filter_headlines(headlines or [], MAX_HEADLINES),
    }


def call_deepseek(
    context: dict,
    api_key: str,
) -> dict:
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
    if not isinstance(parsed.get("signal"), dict) or not isinstance(parsed.get("risks"), list):
        raise ValueError("model JSON missing signal or risks")
    return parsed


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
        "hot": bool(raw.get("hot")),
        "t": title,
        "d": detail,
        "src": source,
    }
    if url:
        event["url"] = url
    return event


def _factor(raw: object, allowed_dims: tuple[str, ...]) -> dict | None:
    if not isinstance(raw, dict):
        return None
    dim = raw.get("dim")
    key = raw.get("k")
    value = raw.get("v")
    if dim not in allowed_dims:
        return None
    if not isinstance(key, str) or not isinstance(value, str):
        return None
    key, value = key.strip(), value.strip()
    if not (3 <= len(key) <= 40 and 10 <= len(value) <= 180):
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
    bull_rows = [row for row in (_factor(item, BULL_DIMS) for item in bull) if row]
    bear_rows = [row for row in (_factor(item, BEAR_DIMS) for item in bear) if row]
    if len(bull_rows) < 3 or len(bear_rows) < 3:
        return None
    # Ensure all required dimensions are covered without duplicate dimensions
    if {r["dim"] for r in bull_rows[:3]} != set(BULL_DIMS) or {r["dim"] for r in bear_rows[:3]} != set(BEAR_DIMS):
        # Fall back to unique by dim
        bull_by_dim = {r["dim"]: r for r in bull_rows}
        bear_by_dim = {r["dim"]: r for r in bear_rows}
        if set(bull_by_dim.keys()) != set(BULL_DIMS) or set(bear_by_dim.keys()) != set(BEAR_DIMS):
            return None
        bull_rows = [bull_by_dim[d] for d in BULL_DIMS]
        bear_rows = [bear_by_dim[d] for d in BEAR_DIMS]
    return {
        "secTitle": "产业与市场信号",
        "secHint": "只根据已经对上的价格和成交占比。未接入的指标不下结论",
        "verdict": verdict.strip(),
        "sub": sub.strip(),
        "bullTitle": "利多支撑",
        "bullHint": "结构性景气驱动",
        "bull": bull_rows[:3],
        "bearTitle": "潜在风险",
        "bearHint": "抑制估值与斜率",
        "bear": bear_rows[:3],
        "watch": watch.strip(),
    }


def normalize_risks(raw: object) -> list[dict] | None:
    if not isinstance(raw, list):
        return None
    rows: list[dict] = []
    level_map = {
        "high": "high",
        "med": "med",
        "low": "low",
        "r": "high",
        "a": "med",
        "g": "low",
    }
    for item in raw:
        if not isinstance(item, dict):
            continue
        raw_level = item.get("level")
        if not isinstance(raw_level, str):
            continue
        level = level_map.get(raw_level.strip().lower())
        if not level:
            continue
        key = item.get("k")
        desc = item.get("desc")
        source = item.get("src")
        if not all(isinstance(value, str) for value in (key, desc, source)):
            continue
        key, desc, source = key.strip(), desc.strip(), source.strip()
        if not (3 <= len(key) <= 40 and 15 <= len(desc) <= 240 and 2 <= len(source) <= 80):
            continue
        rows.append({"k": key, "level": level, "desc": desc, "src": source})
    return rows[:3] if len(rows) >= 3 else None


def normalize_closing_review(
    raw: object,
    existing: dict | None,
    moment: datetime,
) -> dict | None:
    if not isinstance(raw, dict):
        return None
    verdict = raw.get("verdict")
    pillars = raw.get("pillars")
    cross_market = raw.get("crossMarket")
    next_day_watch = raw.get("nextDayWatch")

    # 1. 校验 verdict
    if not isinstance(verdict, dict):
        return None
    headline = verdict.get("headline")
    core_summary = verdict.get("coreSummary")
    risk_tone = verdict.get("riskTone")
    primary_driver = verdict.get("primaryDriver")
    if not all(isinstance(v, str) and v.strip() for v in (headline, core_summary, risk_tone, primary_driver)):
        return None

    # 2. 校验 pillars：必须包含 crowding, liquidity, macro, industry，且 weight 之和为 100
    if not isinstance(pillars, list) or len(pillars) != 4:
        return None
    allowed_ids = {"crowding", "liquidity", "macro", "industry"}
    seen_ids = set()
    total_weight = 0
    norm_pillars = []
    for p in pillars:
        if not isinstance(p, dict):
            return None
        pid = p.get("id")
        if pid not in allowed_ids or pid in seen_ids:
            return None
        seen_ids.add(pid)
        weight = p.get("weight")
        if not isinstance(weight, (int, float)):
            return None
        total_weight += int(weight)
        norm_pillars.append(p)
    if seen_ids != allowed_ids or total_weight != 100:
        return None

    # 3. 校验 crossMarket
    if not isinstance(cross_market, dict):
        return None
    spread_metric = cross_market.get("spreadMetric")
    div_logic = cross_market.get("divergenceLogic")
    lead_lag = cross_market.get("leadLagSignal")
    if not all(isinstance(v, str) and v.strip() for v in (spread_metric, div_logic, lead_lag)):
        return None

    # 4. 校验 nextDayWatch
    if not isinstance(next_day_watch, list) or len(next_day_watch) < 2:
        return None

    # 5. 保留 existing 中的 tradingPhase 和 marketClock（由客户端动态时钟和 refresh_tech_semi_data 驱动）
    trading_phase = (existing or {}).get("tradingPhase") or {
        "phase": "APAC_POST_MARKET",
        "headline": "亚太盘后定型 · 欧美盘前博弈窗口",
        "window": "15:00 ~ 18:00 CST",
    }
    market_clock = (existing or {}).get("marketClock") or []

    return {
        "asOf": moment.strftime("%Y-%m-%d %H:%M"),
        "tradingPhase": trading_phase,
        "verdict": {
            "headline": headline.strip(),
            "coreSummary": core_summary.strip(),
            "riskTone": risk_tone.strip(),
            "primaryDriver": primary_driver.strip(),
        },
        "marketClock": market_clock,
        "pillars": norm_pillars,
        "crossMarket": {
            "spreadMetric": spread_metric.strip(),
            "spreadStatus": cross_market.get("spreadStatus", "divergence"),
            "divergenceLogic": div_logic.strip(),
            "leadLagSignal": lead_lag.strip(),
        },
        "nextDayWatch": next_day_watch,
    }


def merge_timeline(existing: list, incoming: list[dict], today: date) -> list[dict]:
    kept: list[dict] = []
    seen: set[str] = set()
    for item in incoming + [row for row in existing if isinstance(row, dict)]:
        key = fingerprint(item, today)
        if not key or key in seen:
            continue
        item_date = parse_item_date(item, today)
        if item_date is None:
            continue
        if item_date < today - timedelta(days=MAX_AGE_DAYS):
            continue
        seen.add(key)
        kept.append(item)
    # 严格按日期降序排序（最新日期在前），并保留最新条目
    kept.sort(key=lambda x: str(x.get("date", "")), reverse=True)
    return kept[:MAX_TIMELINE]


def mock_payload_for_doc(doc: dict, headlines: list[dict[str, str]] | None = None) -> dict:
    today_str = datetime.now(SHANGHAI).strftime("%Y-%m-%d")
    sample_url = ""
    if headlines:
        for h in headlines:
            link = h.get("link", "")
            if link.startswith("https://"):
                sample_url = link
                break

    events = [
        {
            "date": today_str,
            "tag": "算力基础设施",
            "hot": True,
            "t": "海外核心云厂商追加下一代芯片预定，算力供应链能见度延伸",
            "d": "主流云厂商在最新产业链交流中进一步明确 2026-2027 年资本开支指引，针对高算力芯片与先进封装产能提出更高保障要求，供应链订单预期与交付确定性持续提升。海外先进制程代工产线稼动率维持饱满，关键互联器件与封装材料交付周期保持稳定，为行业结构性高景气提供基本面支撑。",
            "src": "来源：行业跟踪分析",
            "url": sample_url,
        }
    ]

    return {
        "events": events,
        "signal": {
            "verdict": "TMT 成交额占比与高位估值消化呈现结构性分化，需结合芯片 ETF 当日盘面与云厂商资本开支综合评估。",
            "sub": "费半、科创50与中证半导体 ETF 价格由行情实时刷新；两融买入占比反映杠杆情绪，未核实指标不作主观臆断。",
            "bull": [
                {
                    "dim": "capex",
                    "k": "北美 CSP 资本开支维持强韧",
                    "v": "大型云厂商持续追加 AI 算力集群与光模块部署投入，海外龙头订单能见度延伸至 2027 年",
                },
                {
                    "dim": "foundry",
                    "k": "先进制程与先进封装供不应求",
                    "v": "台积电 3nm/2nm 节点及 CoWoS 封装良率与稼动率稳健提升，晶圆代工议价能力保持高位",
                },
                {
                    "dim": "substitute",
                    "k": "国内半导体自主化渗透提速",
                    "v": "国产先进制程产线验证加快，前道关键设备与零部件本土替代率继续温和上升",
                },
            ],
            "bear": [
                {
                    "dim": "mature",
                    "k": "成熟制程晶圆代工价格竞争",
                    "v": "全球成熟制程产能持续释放，消费电子与通用模拟芯片需求平淡，代工毛利面临下行压力",
                },
                {
                    "dim": "geo",
                    "k": "地缘出口管制与供应链摩擦",
                    "v": "算力芯片限售规格与先进制程光刻设备管制政策仍存不确定性，扰动供应链采购节奏",
                },
                {
                    "dim": "memory",
                    "k": "通用存储周期步入高位震荡",
                    "v": "传统 DRAM/NAND 现货提价斜率趋缓，HBM 溢价分化加剧，需警惕通用存储库存周期反复",
                },
            ],
            "watch": "TMT 成交占比分位 · 芯片 ETF 盘面量价 · 北美云厂商下季开支指引 · 先进制程交期",
        },
        "risks": [
            {
                "k": "全球宏观利率与估值波动",
                "level": "med",
                "desc": "高估值成长板块对海外无风险利率与流动性敏感，若降息节奏不及预期可能带来阶段性估值承压。",
                "src": "宏观研究",
            },
            {
                "k": "地缘出口管制规则收紧",
                "level": "high",
                "desc": "多国针对高性能计算与先进制程半导体设备管制范围若进一步调整，可能扰动全球供应链分工及产能建设周期。",
                "src": "政策观察",
            },
            {
                "k": "终端 AI 应用落地与商业回报放缓",
                "level": "med",
                "desc": "若下游企业客户在 AI 软件端商业化回报不及预期，云厂商可能在未来财年边际放缓资本开支扩张步伐。",
                "src": "科技产业洞察",
            },
        ],
        "closingReview": doc.get("closingReview"),
    }


def refresh_tech_semi_timeline(
    dry_run: bool = False,
    data_path: Path | None = None,
    headlines: list[dict[str, str]] | None = None,
    model_payload: dict | None = None,
    api_key: str | None = None,
) -> int:
    path = TECH_SEMI_PATH if data_path is None else data_path
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
        if dry_run:
            log("INFO", f"headline fetch failed in dry-run ({exc}); using mock headline")
            rows = [
                {
                    "title": "TSMC ramps 2nm wafer capacity and CoWoS advanced packaging",
                    "source": "Reuters",
                    "published": "Mon, 28 Sep 2026 00:00:00 GMT",
                    "link": "https://news.google.com/rss/articles/sample-tsmc-2nm",
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
                    "title": "TSMC ramps 2nm wafer capacity and CoWoS advanced packaging",
                    "source": "Reuters",
                    "published": "Mon, 28 Sep 2026 00:00:00 GMT",
                    "link": "https://news.google.com/rss/articles/sample-tsmc-2nm",
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
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, KeyError, ValueError, OSError) as exc:
        log("WARN", f"model call failed; narrative left unchanged: {exc}")
        return 0

    events = [item for item in (normalize_event(row, rows) for row in payload.get("events", [])) if item]
    signal = normalize_signal(payload.get("signal"))
    risks = normalize_risks(payload.get("risks"))
    if signal is None or risks is None:
        log("WARN", "signal or risks failed validation; narrative left unchanged")
        return 0

    now_shanghai = datetime.now(SHANGHAI)
    norm_cr = normalize_closing_review(payload.get("closingReview"), doc.get("closingReview"), now_shanghai)

    merged = merge_timeline(timeline, events, now_shanghai.date()) if events else timeline
    cr_changed = norm_cr is not None and norm_cr != doc.get("closingReview")
    changed = merged != timeline or signal != doc.get("signal") or risks != doc.get("risks") or cr_changed
    if not changed:
        log("INFO", "narrative unchanged")
        return 0
    doc["timeline"] = merged
    doc["signal"] = signal
    doc["risks"] = risks
    if norm_cr is not None:
        doc["closingReview"] = norm_cr
    log("INFO", f"timeline accepted={len(events)} kept={len(merged)}; signal and risks updated" + (" (closingReview updated)" if cr_changed else ""))

    if dry_run:
        log("INFO", f"dry-run: {path.name} not written")
        return 0

    with tempfile.NamedTemporaryFile("w", dir=path.parent, delete=False, encoding="utf-8") as tmp:
        json.dump(doc, tmp, ensure_ascii=False, indent=2)
        tmp.write("\n")
        tmp_name = tmp.name
    os.replace(tmp_name, path)
    log("INFO", f"wrote {path.name}")
    return 0


def _assert(cond: bool, message: str) -> None:
    if not cond:
        raise AssertionError(message)


def self_test() -> int:
    log("INFO", "running tech semi self-test checks...")

    # 1. RSS parsing & deduplication
    sample_rss = """
    <rss><channel>
      <item>
        <title>TSMC ramps 2nm capacity in Hsinchu</title>
        <source>Reuters</source>
        <pubDate>Mon, 28 Sep 2026 01:00:00 GMT</pubDate>
        <link>https://news.google.com/rss/articles/tsmc-2nm-1</link>
      </item>
      <item>
        <title>TSMC ramps 2nm capacity in Hsinchu</title>
        <source>Duplicate Source</source>
        <link>https://news.google.com/rss/articles/tsmc-2nm-dup</link>
      </item>
      <item>
        <title>&lt;b&gt;ASML&lt;/b&gt; High-NA EUV shipment &amp;amp; installation update</title>
        <source>Bloomberg</source>
        <link>https://news.google.com/rss/articles/asml-high-na</link>
      </item>
      <item>
        <title></title>
        <source>Empty</source>
      </item>
    </channel></rss>
    """
    root = ET.fromstring(sample_rss)
    seen: set[str] = set()
    extracted_headlines: list[dict[str, str]] = []
    for item in root.findall(".//item"):
        title = strip_html(item.findtext("title") or "")
        if not title or title in seen:
            continue
        seen.add(title)
        extracted_headlines.append(
            {
                "title": title,
                "source": (item.findtext("source") or "").strip(),
                "published": (item.findtext("pubDate") or "").strip(),
                "link": (item.findtext("link") or "").strip(),
            }
        )
    _assert(len(extracted_headlines) == 2, f"expected 2 headlines, got {len(extracted_headlines)}")
    _assert(
        extracted_headlines[0]["title"] == "TSMC ramps 2nm capacity in Hsinchu",
        "first headline title mismatch",
    )
    _assert(
        extracted_headlines[1]["title"] == "ASML High-NA EUV shipment &amp; installation update",
        "html stripped title mismatch",
    )
    log("INFO", "1. RSS parsing & deduplication test passed")

    # 2. Context assembly
    mock_doc = {
        "snapshot": "2026-09-28 16:56",
        "benchmarks": {
            "sox": {
                "name": "费城半导体指数",
                "symbol": "^SOX",
                "price": 12668.93,
                "chg": "+1.41%",
                "previousClose": 12492.54,
            },
            "star50": {
                "name": "科创50指数",
                "symbol": "000688.SS",
                "price": 1555.98,
                "chg": "-4.06%",
                "previousClose": 1621.87,
            },
            "kospi": {
                "name": "韩国KOSPI指数",
                "symbol": "^KS11",
                "price": 6889.74,
                "chg": "-2.70%",
                "previousClose": 7080.92,
            },
        },
        "crowding": {
            "label": "极端过热",
            "zone": "danger",
            "turnoverShare": {
                "value": 42.52,
                "tmtAmountYi": 7240.16,
                "marketAmountYi": 17027.99,
            },
        },
        "leverage": {
            "marginBuyShare": {
                "value": 8.59,
                "asOf": "2026-09-24",
                "v": "平常",
            }
        },
        "fundamental": {
            "items": [
                {
                    "k": "四大 CSP 资本开支",
                    "status": "live",
                    "v": "加速",
                    "watch": "Alphabet 全年资本开支上修至 1950–2050 亿美元",
                },
                {
                    "k": "CoWoS 与交付周期",
                    "status": "pending",
                    "v": "未接入",
                    "watch": "看交付周数是拉长还是缩短",
                },
            ]
        },
        "timeline": [
            {"date": f"2026-09-{20 + i:02d}", "tag": "算力基础设施", "t": f"既有时间轴事实 {i}"}
            for i in range(12)
        ],
    }
    ctx = extract_context(mock_doc, extracted_headlines)
    _assert(ctx["benchmarks"]["sox"]["price"] == 12668.93, "sox price mismatch")
    _assert(ctx["benchmarks"]["star50"]["chg"] == "-4.06%", "star50 chg mismatch")
    _assert(ctx["benchmarks"]["kospi"]["previousClose"] == 7080.92, "kospi previousClose mismatch")
    _assert(ctx["crowding"]["turnoverShare"] == 42.52, "turnoverShare mismatch")
    _assert(ctx["crowding"]["zone"] == "danger", "crowding zone mismatch")
    _assert(ctx["leverage"]["marginBuyShare"] == 8.59, "marginBuyShare mismatch")
    _assert(ctx["leverage"]["asOf"] == "2026-09-24", "marginBuyShare asOf mismatch")
    _assert(ctx["fundamental"]["csp_capex"]["status"] == "live", "csp_capex status mismatch")
    _assert(ctx["fundamental"]["csp_capex"]["v"] == "加速", "csp_capex v mismatch")
    _assert(len(ctx["existing_timeline"]) == 8, f"expected 8 prior items, got {len(ctx['existing_timeline'])}")
    _assert(len(ctx["headlines"]) == 2, "headlines mismatch in context")
    log("INFO", "2. Context assembly test passed")

    # 3. JSON parsing and schema validation
    raw_markdown_json = """```json
    {
      "events": [
        {
          "date": "2026-09-28",
          "tag": "算力基础设施",
          "hot": true,
          "t": "海外核心云厂商追加下一代芯片预定，算力供应链能见度延伸",
          "d": "主流云厂商在最新产业链交流中进一步明确 2026-2027 年资本开支指引，针对高算力芯片与先进封装产能提出更高保障要求，供应链订单预期与交付确定性持续提升。海外先进制程代工产线稼动率维持饱满，关键互联器件与封装材料交付周期保持稳定，为行业结构性高景气提供基本面支撑。",
          "src": "来源：行业跟踪分析",
          "url": "https://news.google.com/rss/articles/tsmc-2nm-1"
        }
      ],
      "signal": {
        "verdict": "TMT 成交额占比与高位估值消化呈现结构性分化，需结合芯片 ETF 当日盘面与云厂商资本开支综合评估。",
        "sub": "费半、科创50与中证半导体 ETF 价格由行情实时刷新；两融买入占比反映杠杆情绪，未核实指标不作主观臆断。",
        "bull": [
          {"dim": "capex", "k": "北美 CSP 资本开支维持强韧", "v": "大型云厂商持续追加 AI 算力集群与光模块部署投入，海外龙头订单能见度延伸至 2027 年"},
          {"dim": "foundry", "k": "先进制程与先进封装供不应求", "v": "台积电 3nm/2nm 节点及 CoWoS 封装良率与稼动率稳健提升，晶圆代工议价能力保持高位"},
          {"dim": "substitute", "k": "国内半导体自主化渗透提速", "v": "国产先进制程产线验证加快，前道关键设备与零部件本土替代率继续温和上升"}
        ],
        "bear": [
          {"dim": "mature", "k": "成熟制程晶圆代工价格竞争", "v": "全球成熟制程产能持续释放，消费电子与通用模拟芯片需求平淡，代工毛利面临下行压力"},
          {"dim": "geo", "k": "地缘出口管制与供应链摩擦", "v": "算力芯片限售规格与先进制程光刻设备管制政策仍存不确定性，扰动供应链采购节奏"},
          {"dim": "memory", "k": "通用存储周期步入高位震荡", "v": "传统 DRAM/NAND 现货提价斜率趋缓，HBM 溢价分化加剧，需警惕通用存储库存周期反复"}
        ],
        "watch": "TMT 成交占比分位 · 芯片 ETF 盘面量价 · 北美云厂商下季开支指引 · 先进制程交期"
      },
      "risks": [
        {"k": "全球宏观利率与估值波动", "level": "med", "desc": "高估值成长板块对海外无风险利率与流动性敏感，若降息节奏不及预期可能带来阶段性估值承压。", "src": "宏观研究"},
        {"k": "地缘出口管制规则收紧", "level": "high", "desc": "多国针对高性能计算与先进制程半导体设备管制范围若进一步调整，可能扰动全球供应链分工及产能建设周期。", "src": "政策观察"},
        {"k": "终端 AI 应用落地与商业回报放缓", "level": "med", "desc": "若下游企业客户在 AI 软件端商业化回报不及预期，云厂商可能在未来财年边际放缓资本开支扩张步伐。", "src": "科技产业洞察"}
      ]
    }
    ```"""
    parsed = parse_model_json(raw_markdown_json)
    _assert(isinstance(parsed, dict) and "events" in parsed, "parse_model_json markdown failure")

    # Event normalization & rejection cases
    valid_ev = normalize_event(parsed["events"][0], extracted_headlines)
    _assert(valid_ev is not None, "valid event rejected")
    _assert(valid_ev["url"] == "https://news.google.com/rss/articles/tsmc-2nm-1", "url preserved")

    # Reject unlisted URL by stripping
    ev_bad_url = normalize_event(
        {**parsed["events"][0], "url": "https://unauthorized.org/article"},
        extracted_headlines,
    )
    _assert(ev_bad_url is not None and "url" not in ev_bad_url, "unauthorized URL should be stripped")

    # Reject invalid tag
    _assert(normalize_event({**parsed["events"][0], "tag": "突发行情"}, extracted_headlines) is None, "bad tag must fail")

    # Reject invalid date
    _assert(normalize_event({**parsed["events"][0], "date": "09-28"}, extracted_headlines) is None, "bad date format must fail")
    _assert(normalize_event({**parsed["events"][0], "date": "2026-13-45"}, extracted_headlines) is None, "invalid date must fail")

    # Reject bad lengths
    _assert(normalize_event({**parsed["events"][0], "t": "短标题"}, extracted_headlines) is None, "short title must fail")
    _assert(normalize_event({**parsed["events"][0], "d": "过短的正文描述"}, extracted_headlines) is None, "short detail must fail")
    _assert(normalize_event({**parsed["events"][0], "src": "彭博社"}, extracted_headlines) is None, "src without prefix must fail")

    # Signal normalization
    valid_sig = normalize_signal(parsed["signal"])
    _assert(valid_sig is not None, "valid signal rejected")
    _assert(valid_sig["secTitle"] == "产业与市场信号", "secTitle mismatch")
    _assert(len(valid_sig["bull"]) == 3, "bull items length mismatch")
    _assert(len(valid_sig["bear"]) == 3, "bear items length mismatch")

    # Signal rejection cases
    _assert(normalize_signal({**parsed["signal"], "bull": parsed["signal"]["bull"][:2]}) is None, "insufficient bull must fail")
    _assert(
        normalize_signal({
            **parsed["signal"],
            "bull": [
                {"dim": "invalid_dim", "k": "有效键名", "v": "有效的内容描述长度符合规范要求"},
                *parsed["signal"]["bull"][1:],
            ],
        }) is None,
        "invalid bull dim must fail",
    )

    # Risks normalization and level mapping
    valid_risks = normalize_risks(parsed["risks"])
    _assert(valid_risks is not None and len(valid_risks) == 3, "valid risks rejected")
    _assert(valid_risks[0]["level"] == "med" and valid_risks[1]["level"] == "high", "risk level mismatch")

    # Test r, a, g level conversion
    converted_risks = normalize_risks([
        {"k": "地缘管制变量", "level": "r", "desc": "出口管制范围扩大可能造成产业链交付与装机节奏延期。", "src": "政策跟踪"},
        {"k": "代工毛利率变动", "level": "a", "desc": "成熟制程晶圆代工竞争加剧压制传统制程毛利水平。", "src": "产业链调研"},
        {"k": "算力基础设施投资", "level": "g", "desc": "云厂商保持强韧资本开支支持先进制程与封装需求扩容。", "src": "公开财报"},
    ])
    _assert(converted_risks is not None, "converted risks rejected")
    _assert([r["level"] for r in converted_risks] == ["high", "med", "low"], "r/a/g mapping failed")

    log("INFO", "3. JSON parsing and schema validation test passed")

    # 4. Timeline merging, deduplication, and 30-day pruning
    today = date(2026, 9, 28)
    existing_items = [
        {
            "date": "2026-09-24",
            "tag": "算力基础设施",
            "t": "头部云厂商追加 2027 年先进 AI 算力集群预定订单",
            "d": "海外科技巨头重申对生成式 AI 资本开支承诺。",
            "src": "来源：彭博社",
        },
        {
            "date": "09-23",  # legacy MM-DD format within 30 days
            "tag": "制程产能",
            "t": "台积电先进制程扩产计划顺利推进，先进封装良率突破预期",
            "d": "新竹与高雄先进制程晶圆厂装机按期完成。",
            "src": "来源：电子时报",
        },
        {
            "date": "2026-08-10",  # older than 30 days -> must be pruned
            "tag": "行业周期",
            "t": "历史早期待修剪事件，时间超过三十天应剔除",
            "d": "早前事件详细正文内容描述。",
            "src": "来源：公开报道",
        },
        {
            "date": "08-01",  # legacy MM-DD older than 30 days -> must be pruned
            "tag": "行业周期",
            "t": "八月初历史事件，时间超过三十天应剔除",
            "d": "八月初事件正文内容描述。",
            "src": "来源：公开报道",
        },
    ]

    new_events = [
        {
            "date": "2026-09-28",
            "tag": "国产替代",
            "hot": True,
            "t": "国内前道半导体关键设备验证提速，先进制程装机稳步推进",
            "d": "主流存储与逻辑晶圆厂关键产线验证批次持续放量，核心零部件本土化配套率稳健提升。",
            "src": "来源：行业跟踪",
            "url": "https://news.google.com/rss/articles/tsmc-2nm-1",
        },
        # Duplicate of existing item
        {
            "date": "2026-09-24",
            "tag": "算力基础设施",
            "t": "头部云厂商追加 2027 年先进 AI 算力集群预定订单",
            "d": "重复内容，不应被二次录入。",
            "src": "来源：彭博社",
        },
    ]

    merged_tl = merge_timeline(existing_items, new_events, today)
    _assert(len(merged_tl) == 3, f"expected 3 items after deduplication & pruning, got {len(merged_tl)}")
    _assert(merged_tl[0]["date"] == "2026-09-28", "newest item must be prepended")
    _assert(merged_tl[1]["t"] == "头部云厂商追加 2027 年先进 AI 算力集群预定订单", "duplicate not deduplicated properly")
    _assert(merged_tl[2]["date"] == "09-23", "valid MM-DD within 30 days not preserved")

    # Max timeline cap check
    bulk_events = [
        {
            "date": f"2026-09-{(i % 25) + 1:02d}",
            "tag": "制程产能",
            "t": f"大量测试事件标题编号达到上限截断测试序号_{i}",
            "d": "详细内容测试描述文字填充足够的字符长度以满足要求。",
            "src": "来源：测试",
        }
        for i in range(25)
    ]
    capped_tl = merge_timeline([], bulk_events, today)
    _assert(len(capped_tl) == MAX_TIMELINE, f"expected capped {MAX_TIMELINE}, got {len(capped_tl)}")
    log("INFO", "4. Timeline merging, deduplication, and 30-day pruning test passed")

    # 5. Data updating preserving 100% of unmanaged fields
    full_mock_doc = {
        "snapshot": "2026-09-28 16:56",
        "head": {
            "kicker": "THEME 04 · TECH & SEMICONDUCTOR",
            "title": "科技指数宏观",
            "sub": "以费城半导体指数为核心，对照科创50与中证半导体 ETF。",
        },
        "benchmarks": mock_doc["benchmarks"],
        "signal": {
            "verdict": "旧研判总结",
            "sub": "旧口径说明",
            "bull": [
                {"dim": "capex", "k": "旧利多1", "v": "旧利多描述1"},
                {"dim": "foundry", "k": "旧利多2", "v": "旧利多描述2"},
                {"dim": "substitute", "k": "旧利多3", "v": "旧利多描述3"},
            ],
            "bear": [
                {"dim": "mature", "k": "旧利空1", "v": "旧利空描述1"},
                {"dim": "geo", "k": "旧利空2", "v": "旧利空描述2"},
                {"dim": "memory", "k": "旧利空3", "v": "旧利空描述3"},
            ],
            "watch": "旧观察指标",
        },
        "charts": {
            "normalized": {
                "dates": ["09-24", "09-25"],
                "sox": [1.5, 2.0],
                "kospi": [-0.5, -0.8],
                "star50": [-1.0, -1.5],
            }
        },
        "timeline": existing_items[:2],
        "news": [
            {
                "title": "全球半导体月度销售额同比保持双位数增长",
                "src": "SIA",
                "date": "09-23",
                "url": "https://www.semiconductors.org/",
            }
        ],
        "risks": [
            {"k": "旧风险1", "level": "low", "desc": "旧风险描述1", "src": "来源1"},
            {"k": "旧风险2", "level": "med", "desc": "旧风险描述2", "src": "来源2"},
            {"k": "旧风险3", "level": "high", "desc": "旧风险描述3", "src": "来源3"},
        ],
        "footer": "行情快照每小时由 GitHub Actions 定时刷新",
        "crowding": mock_doc["crowding"],
        "anomalies": {
            "note": "异动位观察说明",
            "items": [{"k": "资金暗中撤退", "v": "未接入"}],
        },
        "leverage": mock_doc["leverage"],
        "fundamental": mock_doc["fundamental"],
    }

    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as tmp:
        json.dump(full_mock_doc, tmp, ensure_ascii=False, indent=2)
        tmp_path = Path(tmp.name)

    try:
        orig_doc = copy.deepcopy(full_mock_doc)

        # Test dry-run: file should NOT be changed
        ret_dry = refresh_tech_semi_timeline(
            dry_run=True,
            data_path=tmp_path,
            headlines=extracted_headlines,
            model_payload=parsed,
        )
        _assert(ret_dry == 0, "dry-run returned non-zero")
        with tmp_path.open(encoding="utf-8") as f:
            after_dry = json.load(f)
        _assert(after_dry == orig_doc, "dry-run mutated file")

        # Test real run: file should be updated atomically
        ret_real = refresh_tech_semi_timeline(
            dry_run=False,
            data_path=tmp_path,
            headlines=extracted_headlines,
            model_payload=parsed,
        )
        _assert(ret_real == 0, "real run returned non-zero")
        with tmp_path.open(encoding="utf-8") as f:
            updated_doc = json.load(f)

        # Verify unmanaged fields are 100% untouched
        unmanaged_keys = (
            "snapshot",
            "head",
            "benchmarks",
            "charts",
            "crowding",
            "leverage",
            "anomalies",
            "fundamental",
            "footer",
            "news",
        )
        for key in unmanaged_keys:
            _assert(
                updated_doc[key] == orig_doc[key],
                f"unmanaged field mutated: {key}",
            )

        # Verify managed fields are updated
        _assert(updated_doc["timeline"] != orig_doc["timeline"], "timeline was not updated")
        _assert(updated_doc["signal"] != orig_doc["signal"], "signal was not updated")
        _assert(updated_doc["risks"] != orig_doc["risks"], "risks was not updated")
        _assert(len(updated_doc["timeline"]) == 3, "timeline length mismatch after update")
        _assert(updated_doc["risks"][0]["k"] == "全球宏观利率与估值波动", "risks content mismatch")
        _assert(updated_doc["signal"]["secTitle"] == "产业与市场信号", "signal content mismatch")

        log("INFO", "5. Data updating preserving 100% of unmanaged fields test passed")
    finally:
        if tmp_path.exists():
            tmp_path.unlink()

    log("INFO", "ALL tech semi self-test checks passed successfully!")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Refresh tech semiconductor timeline via DeepSeek.")
    parser.add_argument("--dry-run", action="store_true", help="Fetch and validate without writing data.")
    parser.add_argument("--self-test", action="store_true", help="Run offline unit assertions.")
    args = parser.parse_args()

    if args.self_test:
        return self_test()

    return refresh_tech_semi_timeline(dry_run=args.dry_run)


if __name__ == "__main__":
    sys.exit(main())
