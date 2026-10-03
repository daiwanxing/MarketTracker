#!/usr/bin/env python3
"""Refresh gold cognitive narrative from headlines and market state via DeepSeek.

Rewrites technical levels (support/resistance/trend), risk-reward parameters,
macro drivers, and tactical action plans on ``src/data/goldData.json``.
Numeric keys owned by ``scripts/refresh_market_data.py`` (candles, volume,
momentum, spot price, positioning table) stay untouched. A failed fetch or model
call leaves the file unchanged.

Sources: Google News RSS (English + Chinese gold queries, last 24h).
Model: DeepSeek ``deepseek-flash`` (DeepSeek-V4.1-Flash) at ``https://api.deepseek.com/chat/completions``.
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
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
GOLD_PATH = ROOT / "src" / "data" / "goldData.json"
SHANGHAI = ZoneInfo("Asia/Shanghai")
UA = "Mozilla/5.0 (compatible; MarketTrackerGoldTimeline/1.0; +https://github.com/daiwanxing/MarketTracker)"
DEEPSEEK_URL = "https://api.deepseek.com/chat/completions"
RSS_QUERIES = (
    "https://news.google.com/rss/search?q=gold+OR+XAU+OR+bullion+when:1d&hl=en-US&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q=%E9%BB%84%E9%87%91+OR+%E4%BC%A6%E6%95%A6%E9%87%91+when:1d&hl=zh-CN&gl=CN&ceid=CN:zh-Hans",
)
MAX_HEADLINES = 12
MAX_RAW_HEADLINES = 40

GOLD_KEYWORDS = (
    "fed", "美联储", "fomc", "powell", "鲍威尔", "interest rate", "利率",
    "inflation", "通胀", "treasury", "美债", "yield", "收益率", "dollar", "美元", "dxy",
    "central bank", "央行", "gold", "黄金", "伦敦金", "comex", "xau",
    "etf", "spdr", "safe haven", "避险", "geopolitical", "地缘", "cpi", "pce",
    "nonfarm", "非农", "payroll", "金价",
)
NOISE_KEYWORDS = (
    "gold jewelry", "golden retriever", "gold glove", "gold medal", "golden state",
    "earrings", "ring", "necklace", "fashion", "gold coast",
)

SYSTEM_PROMPT = """你是大宗商品与贵金属卖方研究编辑，按彭博终端（Bloomberg Terminal）与顶级投行研报口径更新黄金行情决策看板。
输入包含当前盘面报价（现货 XAU/USD、COMEX GC、期现基差、美元指数 DXY、10 年期美债收益率）、既有技术位、盈亏比参数、宏观因子及 24 小时全球中英资讯。
只依据这些事实材料，不编造未出现的数字与虚假行情。

【文风与表达禁令】
- 严禁任何自媒体口语与情绪词：突发、暴跌、狂飙、抢购、散户、我们、大家、避坑、焦虑、极端暴涨、割肉、适合买入、继续拿。
- 替换为机构专业术语：承压、高位震荡、下行探底、前瞻中枢、机构持仓、市场、保持观察、估值消化。
- 语言风格：冷峻精炼、逻辑严密、事实优先。

【输出要求与数据契约】
必须严格输出且仅输出合法 JSON 对象，包含以下字段：
{
  "tech": {
    "support": [number, number],
    "resistance": [number, number],
    "trend": "string",
    "supportDesc": "string",
    "resistanceDesc": "string"
  },
  "riskReward": {
    "support": number,
    "resistance": number,
    "stop": number,
    "src": "string"
  },
  "macro_updates": [
    {
      "k": "string",
      "v": "string",
      "signal": "bull | bear | flat",
      "signalText": "string"
    }
  ],
  "action": {
    "summary": "string",
    "plans": [
      { "who": "短线交易者", "stance": "...", "action": "..." },
      { "who": "中长线 / 波段交易者", "stance": "...", "action": "..." }
    ]
  },
  "footer": "string"
}

【边界与数值纪律】
1. tech.support: 必须是 [min, max] 升序数组，且两个数值必须严格小于当前现货价 price。
2. tech.resistance: 必须是 [min, max] 升序数组，且两个数值必须严格大于当前现货价 price。
3. riskReward: 必须严格满足 stop < support < price < resistance。
4. macro_updates: k 为已有宏观驱动因子名称（如「美债 10 年期收益率」、「美元指数」、「美联储利率路径」、「全球央行购金」、「地缘避险」），v 为客观分析（50-180 字），signal 只能是 bull/bear/flat，signalText 为简要研判标签。
5. action.plans: 角色为「短线交易者」与「中长线 / 波段交易者」，立足客观交易纪律，不给绝对投资建议。"""


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


def _num(value: object) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value.replace(",", "").strip())
        except ValueError:
            return None
    return None


def _format_num(val: float) -> int | float:
    return int(val) if val.is_integer() else round(val, 2)


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
        for kw in GOLD_KEYWORDS:
            if kw in title:
                score += 3
        if any(s in source for s in ("reuters", "bloomberg", "wsj", "cnbc", "kitco", "fxstreet", "fx678")):
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


def extract_context(doc: dict, headlines: list[dict[str, str]]) -> dict:
    main = doc.get("metrics", {}).get("main", {})
    quotes = main.get("quotes") if isinstance(main.get("quotes"), dict) else {}
    spot = _num(main.get("num"))
    chg = main.get("chg")
    gc = _num(quotes.get("gc"))
    dxy = _num(quotes.get("dxy"))
    basis = round(gc - spot, 2) if (gc is not None and spot is not None) else None

    us10y_yield = None
    for it in doc.get("macro", {}).get("items", []):
        if not isinstance(it, dict):
            continue
        k = it.get("k", "")
        if "美债 10 年期收益率" in k or ("美债" in k and "10" in k):
            q = it.get("quote")
            if isinstance(q, dict) and "value" in q:
                us10y_yield = f"{q['value']}%"
            elif "v" in it:
                us10y_yield = it["v"]
            break

    tech = doc.get("tech", {})
    tech_ctx = {
        "support": tech.get("support"),
        "resistance": tech.get("resistance"),
        "trend": tech.get("trend"),
    }

    sentiment = doc.get("sentiment", {})
    rr = sentiment.get("riskReward", {})
    rr_ctx = {
        "price": rr.get("price", spot),
        "support": rr.get("support"),
        "resistance": rr.get("resistance"),
        "stop": rr.get("stop"),
    }

    action = doc.get("action", {})
    action_ctx = {
        "summary": action.get("summary"),
        "plans": action.get("plans"),
    }

    macro_items = [
        {
            "k": it.get("k"),
            "signal": it.get("signal"),
            "signalText": it.get("signalText"),
            "v": it.get("v"),
        }
        for it in doc.get("macro", {}).get("items", [])
        if isinstance(it, dict)
    ]

    return {
        "asOf": datetime.now(SHANGHAI).strftime("%Y-%m-%d %H:%M 上海"),
        "pricing": {
            "spot": spot,
            "chg": chg,
            "gc": gc,
            "basis": basis,
            "dxy": dxy,
            "us10y": us10y_yield,
        },
        "tech": tech_ctx,
        "riskReward": rr_ctx,
        "macro": macro_items,
        "action": action_ctx,
        "headlines": rank_and_filter_headlines(headlines, MAX_HEADLINES),
    }


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
    context: dict,
    api_key: str,
) -> dict:
    body = {
        "model": "deepseek-flash",
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
        raise ValueError("empty choices in model response")
    content = choices[0]["message"]["content"]
    parsed = parse_model_json(content)
    return parsed


def validate_and_sanitize_tech(raw: object, price: float, clamp: bool = True) -> dict | None:
    if not isinstance(raw, dict):
        return None
    sup_raw = raw.get("support")
    res_raw = raw.get("resistance")
    if not isinstance(sup_raw, (list, tuple)) or len(sup_raw) != 2:
        return None
    if not isinstance(res_raw, (list, tuple)) or len(res_raw) != 2:
        return None

    nums_sup = [_num(x) for x in sup_raw]
    nums_res = [_num(x) for x in res_raw]
    if any(x is None or x <= 0 for x in nums_sup + nums_res):
        return None

    s1, s2 = sorted([nums_sup[0], nums_sup[1]])  # type: ignore
    r1, r2 = sorted([nums_res[0], nums_res[1]])  # type: ignore

    if not clamp:
        if not (0 < s1 <= s2 < price < r1 <= r2):
            return None
    else:
        margin = max(5.0, round(price * 0.005, 1))
        # Self-healing for support: both must be < price
        if s2 >= price:
            log("WARN", f"tech.support [{s1}, {s2}] exceeds price {price}; clamping to below spot")
            s2 = min(s2, price - margin)
            if s1 >= s2:
                s1 = s2 - margin
        # Self-healing for resistance: both must be > price
        if r1 <= price:
            log("WARN", f"tech.resistance [{r1}, {r2}] falls below price {price}; clamping to above spot")
            r1 = max(r1, price + margin)
            if r2 <= r1:
                r2 = r1 + margin

        if not (0 < s1 <= s2 < price < r1 <= r2):
            return None

    trend = raw.get("trend")
    sup_desc = raw.get("supportDesc")
    res_desc = raw.get("resistanceDesc")
    if not all(isinstance(x, str) for x in (trend, sup_desc, res_desc)):
        return None

    trend = trend.strip()
    sup_desc = sup_desc.strip()
    res_desc = res_desc.strip()
    if len(trend) < 15 or len(sup_desc) < 10 or len(res_desc) < 10:
        return None

    return {
        "support": [_format_num(s1), _format_num(s2)],
        "resistance": [_format_num(r1), _format_num(r2)],
        "trend": trend,
        "supportDesc": sup_desc,
        "resistanceDesc": res_desc,
    }


def validate_and_sanitize_risk_reward(raw: object, price: float, clamp: bool = True) -> dict | None:
    if not isinstance(raw, dict):
        return None
    sup = _num(raw.get("support"))
    res = _num(raw.get("resistance"))
    stop = _num(raw.get("stop"))
    src = raw.get("src")
    if sup is None or res is None or stop is None:
        return None
    if not isinstance(src, str) or len(src.strip()) < 3:
        return None

    if not clamp:
        if not (0 < stop < sup < price < res):
            return None
    else:
        margin = max(5.0, round(price * 0.005, 1))
        # Clamping support if >= price
        if sup >= price:
            log("WARN", f"riskReward support {sup} >= price {price}; clamping support")
            sup = price - margin
        # Clamping resistance if <= price
        if res <= price:
            log("WARN", f"riskReward resistance {res} <= price {price}; clamping resistance")
            res = price + margin
        # Clamping stop if >= support
        if stop >= sup:
            log("WARN", f"riskReward stop {stop} >= support {sup}; clamping stop")
            stop = sup - max(15.0, margin)

        if not (0 < stop < sup < price < res):
            return None

    return {
        "support": _format_num(sup),
        "resistance": _format_num(res),
        "stop": _format_num(stop),
        "src": src.strip(),
    }


def validate_and_sanitize_macro(raw: object) -> list[dict] | None:
    if not isinstance(raw, list):
        return None
    valid: list[dict] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        k = item.get("k")
        v = item.get("v")
        sig = item.get("signal")
        sig_text = item.get("signalText")
        if not all(isinstance(x, str) for x in (k, v, sig, sig_text)):
            continue
        k = k.strip()
        v = v.strip()
        sig = sig.strip()
        sig_text = sig_text.strip()
        if not k or len(v) < 15 or len(sig_text) < 2:
            continue
        if sig not in ("bull", "bear", "flat"):
            continue
        valid.append({
            "k": k,
            "v": v,
            "signal": sig,
            "signalText": sig_text,
        })
    return valid if len(valid) >= 1 else None


def validate_and_sanitize_action(raw: object) -> dict | None:
    if not isinstance(raw, dict):
        return None
    summary = raw.get("summary")
    plans = raw.get("plans")
    if not isinstance(summary, str) or len(summary.strip()) < 15:
        return None
    if not isinstance(plans, list) or len(plans) < 2:
        return None
    sanitized_plans: list[dict] = []
    for p in plans:
        if not isinstance(p, dict):
            continue
        who = p.get("who")
        stance = p.get("stance")
        act = p.get("action")
        if not all(isinstance(x, str) for x in (who, stance, act)):
            continue
        who = who.strip()
        stance = stance.strip()
        act = act.strip()
        if not who or len(stance) < 2 or len(act) < 15:
            continue
        sanitized_plans.append({"who": who, "stance": stance, "action": act})
    if len(sanitized_plans) < 2:
        return None
    return {
        "summary": summary.strip(),
        "plans": sanitized_plans[:2],
    }


def validate_and_sanitize_footer(raw: object) -> str | None:
    if not isinstance(raw, str):
        return None
    cleaned = raw.strip()
    return cleaned if len(cleaned) >= 20 else None


def match_macro_key(item_k: str, update_k: str) -> bool:
    ik = item_k.strip()
    uk = update_k.strip()
    if ik == uk or ik in uk or uk in ik:
        return True
    if ("美债" in ik and "美债" in uk) or ("10年" in ik and "10年" in uk):
        return True
    if "美元" in ik and "美元" in uk:
        return True
    if "央行" in ik and "央行" in uk:
        return True
    if "地缘" in ik and "地缘" in uk:
        return True
    if "美联储" in ik and "美联储" in uk:
        return True
    return False


def apply_narrative_updates(
    doc: dict,
    tech: dict,
    rr: dict,
    macro_updates: list[dict],
    action: dict,
    footer: str | None,
) -> bool:
    changed = False

    # 1. Update tech
    if "tech" not in doc or not isinstance(doc["tech"], dict):
        doc["tech"] = {}
    for key in ("support", "resistance", "trend", "supportDesc", "resistanceDesc"):
        if doc["tech"].get(key) != tech[key]:
            doc["tech"][key] = tech[key]
            changed = True

    # 2. Update sentiment.riskReward
    if "sentiment" not in doc or not isinstance(doc["sentiment"], dict):
        doc["sentiment"] = {}
    if "riskReward" not in doc["sentiment"] or not isinstance(doc["sentiment"]["riskReward"], dict):
        doc["sentiment"]["riskReward"] = {}
    rr_target = doc["sentiment"]["riskReward"]
    for key in ("support", "resistance", "stop", "src"):
        if rr_target.get(key) != rr[key]:
            rr_target[key] = rr[key]
            changed = True

    # 3. Update macro items
    existing_items = doc.get("macro", {}).get("items", [])
    if isinstance(existing_items, list):
        for update in macro_updates:
            matched = False
            for item in existing_items:
                if not isinstance(item, dict):
                    continue
                if match_macro_key(item.get("k", ""), update["k"]):
                    matched = True
                    if item.get("v") != update["v"]:
                        item["v"] = update["v"]
                        changed = True
                    if item.get("signal") != update["signal"]:
                        item["signal"] = update["signal"]
                        changed = True
                    if item.get("signalText") != update["signalText"]:
                        item["signalText"] = update["signalText"]
                        changed = True
                    break
            if not matched:
                log("INFO", f"macro update for '{update['k']}' had no matching item in doc; ignored")

    # 4. Update action
    if "action" not in doc or not isinstance(doc["action"], dict):
        doc["action"] = {}
    if doc["action"].get("summary") != action["summary"]:
        doc["action"]["summary"] = action["summary"]
        changed = True
    if doc["action"].get("plans") != action["plans"]:
        doc["action"]["plans"] = action["plans"]
        changed = True

    # 5. Update footer
    if footer and doc.get("footer") != footer:
        doc["footer"] = footer
        changed = True

    return changed


def _extract_spot_price(doc: dict) -> float | None:
    spot = _num(doc.get("metrics", {}).get("main", {}).get("num"))
    if spot is not None and spot > 0:
        return spot
    rr_price = _num(doc.get("sentiment", {}).get("riskReward", {}).get("price"))
    if rr_price is not None and rr_price > 0:
        return rr_price
    return None


def mock_payload_for_doc(doc: dict) -> dict:
    price = _extract_spot_price(doc)
    if price is None:
        price = 4000.0
    s_low = int(price - 40)
    s_high = int(price - 20)
    r_low = int(price + 30)
    r_high = int(price + 50)
    return {
        "tech": {
            "support": [s_low, s_high],
            "resistance": [r_low, r_high],
            "trend": f"现货围绕 {price:.2f} 震荡整理，日 K 线回踩测试 {s_low}–{s_high} 下轨支撑，反弹受阻于 {r_low}–{r_high} 压力带。",
            "supportDesc": f"{s_low}–{s_high}：前序多头防守中枢与整数关口；若失守将下探更深回撤位。",
            "resistanceDesc": f"{r_low}–{r_high}：前期成交密集区与反弹阻力，需放量站稳方能打开上行空间。",
        },
        "riskReward": {
            "support": s_high,
            "resistance": r_low,
            "stop": s_low - 30,
            "src": f"支撑取 {s_low}–{s_high} 关键防线；压力取 {r_low}–{r_high} 阻力区；现价为快照 {price:.2f}",
        },
        "macro_updates": [
            {
                "k": "美债 10 年期收益率",
                "v": "美债 10 年期收益率高位运行，无风险利率与实际收益率维持偏强格局，持续对不生息资产黄金构成估值压制。",
                "signal": "bear",
                "signalText": "压制金价",
            },
            {
                "k": "美元指数",
                "v": "美元指数窄幅震荡，避险资金阶段性回流美元资产，美欧利差预期支撑美元，压制黄金反弹动能。",
                "signal": "bear",
                "signalText": "高位压制",
            },
            {
                "k": "美联储利率路径",
                "v": "掉期市场持续定价紧缩预期，美联储官员表态整体偏鹰，降息预期受限限制金价估值修复。",
                "signal": "bear",
                "signalText": "收紧预期",
            },
            {
                "k": "全球央行购金",
                "v": "世界黄金协会官方统计显示全球央行购金维持结构性净流入，为中长线金价提供扎实估值底座与底部支撑。",
                "signal": "bull",
                "signalText": "中长线托底",
            },
            {
                "k": "地缘避险",
                "v": "中东及主要地缘热点局势扰动频发，避险情绪对盘面构成间歇性托底，但受制于利率高位未能形成单边趋势。",
                "signal": "bull",
                "signalText": "避险仍在",
            },
        ],
        "action": {
            "summary": f"现货测试 {s_low}–{s_high} 支撑防线 —— 宏观利率与美元逆风未消，短线防守观望，中线等待长端收益率转弱信号确认",
            "plans": [
                {
                    "who": "短线交易者",
                    "stance": "防守观望",
                    "action": f"现货处于 {price:.2f} 附近，密切关注 {s_low}–{s_high} 企稳信号。未放量突破 {r_low} 前不急于抢反弹。",
                },
                {
                    "who": "中长线 / 波段交易者",
                    "stance": "保持耐心",
                    "action": "长端美债收益率偏高压制贵金属估值，维持底仓配置并保持观察，等待美元转弱与降息路径明朗。",
                },
            ],
        },
        "footer": f"主基准：伦敦金现货（gold-api.com，{datetime.now(SHANGHAI).strftime('%Y-%m-%d %H:%M')} 上海，{price:.2f} 美元/盎司）。COMEX 黄金期货与美元指数为最新报价。行情与文字均为静态快照，仅供个人追踪参考，不构成投资建议。",
    }


def refresh_gold_timeline(
    dry_run: bool = False,
    data_path: Path | None = None,
    headlines: list[dict[str, str]] | None = None,
    model_payload: dict | None = None,
    api_key: str | None = None,
) -> int:
    path = GOLD_PATH if data_path is None else data_path
    if not path.exists():
        log("ERROR", f"{path} does not exist")
        return 1
    with path.open(encoding="utf-8") as handle:
        doc = json.load(handle)

    price = _extract_spot_price(doc)
    if price is None:
        log("ERROR", "unable to extract valid gold spot price from document")
        return 1

    try:
        rows = headlines if headlines is not None else fetch_headlines()
    except (urllib.error.URLError, TimeoutError, ET.ParseError, OSError) as exc:
        log("WARN", f"headline fetch failed; narrative left unchanged: {exc}")
        return 0
    if not rows:
        log("WARN", "no headlines found; narrative left unchanged")
        return 0
    log("INFO", f"fetched {len(rows)} headlines")

    context = extract_context(doc, rows)

    try:
        if model_payload is None:
            key = api_key if api_key is not None else os.environ.get("DS_API_KEY", "")
            if not key:
                if dry_run:
                    log("INFO", "DS_API_KEY missing in dry-run mode; using mock payload")
                    payload = mock_payload_for_doc(doc)
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

    tech = validate_and_sanitize_tech(payload.get("tech"), price, clamp=True)
    rr = validate_and_sanitize_risk_reward(payload.get("riskReward"), price, clamp=True)
    macro_updates = validate_and_sanitize_macro(payload.get("macro_updates"))
    action = validate_and_sanitize_action(payload.get("action"))
    footer = validate_and_sanitize_footer(payload.get("footer"))

    if tech is None:
        log("WARN", "tech failed validation; narrative left unchanged")
        return 0
    if rr is None:
        log("WARN", "riskReward failed validation; narrative left unchanged")
        return 0
    if macro_updates is None:
        log("WARN", "macro_updates failed validation; narrative left unchanged")
        return 0
    if action is None:
        log("WARN", "action failed validation; narrative left unchanged")
        return 0

    changed = apply_narrative_updates(doc, tech, rr, macro_updates, action, footer)
    if not changed:
        log("INFO", "narrative unchanged")
        return 0

    log("INFO", f"narrative updated: support={tech['support']} resistance={tech['resistance']} rr_stop={rr['stop']}")

    if dry_run:
        log("INFO", f"dry-run: {path.name} not written")
        return 0

    tmp_path = path.with_suffix(".tmp")
    with tmp_path.open("w", encoding="utf-8") as handle:
        json.dump(doc, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    tmp_path.replace(path)
    log("INFO", f"wrote {path.name}")
    return 0


def _assert(cond: bool, message: str) -> None:
    if not cond:
        raise AssertionError(message)


def self_test() -> int:
    log("INFO", "running self-test checks...")

    # 1. Test RSS parsing
    sample_rss = """
    <rss><channel>
      <item><title>Gold edges lower as dollar firms</title><source>Reuters</source><pubDate>Mon, 28 Sep 2026 00:00:00 GMT</pubDate><link>https://example.com/gold1</link></item>
      <item><title>Gold edges lower as dollar firms</title><source>Duplicate</source></item>
      <item><title>Bullion analysis &lt;b&gt;report&lt;/b&gt;</title><source>Bloomberg</source><link>https://example.com/gold2</link></item>
    </channel></rss>
    """
    root = ET.fromstring(sample_rss)
    parsed_titles = []
    seen = set()
    for item in root.findall(".//item"):
        t = strip_html(item.findtext("title") or "")
        if t in seen:
            continue
        seen.add(t)
        parsed_titles.append(t)
    _assert(parsed_titles == ["Gold edges lower as dollar firms", "Bullion analysis report"], f"rss: {parsed_titles}")

    # 2. Test Context Assembly
    mock_test_doc = {
        "metrics": {
            "main": {
                "num": "4163.90",
                "chg": "-2.59%",
                "quotes": {
                    "gc": 4195.1,
                    "dxy": 101.15,
                },
            }
        },
        "macro": {
            "items": [
                {
                    "k": "美债 10 年期收益率",
                    "quote": {"value": 5.184, "unit": "%", "bp": 2.2},
                }
            ]
        },
        "tech": {
            "support": [4120, 4140],
            "resistance": [4200, 4220],
            "trend": "测试趋势",
        },
        "sentiment": {
            "riskReward": {
                "price": 4163.9,
                "support": 4120,
                "resistance": 4200,
                "stop": 4090,
            }
        },
        "action": {
            "summary": "测试摘要",
            "plans": [
                {"who": "短线交易者", "stance": "防守", "action": "观望"},
                {"who": "中长线 / 波段交易者", "stance": "耐心", "action": "等待"},
            ],
        },
    }
    sample_headlines = [
        {"title": "Gold slips on rates", "source": "Reuters", "published": "2026-09-28", "link": "https://example.com/1"}
    ]
    ctx = extract_context(mock_test_doc, sample_headlines)
    _assert(ctx["pricing"]["spot"] == 4163.9, f"pricing spot {ctx['pricing']['spot']}")
    _assert(ctx["pricing"]["chg"] == "-2.59%", f"pricing chg {ctx['pricing']['chg']}")
    _assert(ctx["pricing"]["gc"] == 4195.1, f"pricing gc {ctx['pricing']['gc']}")
    _assert(ctx["pricing"]["basis"] == 31.2, f"pricing basis {ctx['pricing']['basis']}")
    _assert(ctx["pricing"]["dxy"] == 101.15, f"pricing dxy {ctx['pricing']['dxy']}")
    _assert(ctx["pricing"]["us10y"] is not None, "pricing us10y")
    _assert(ctx["tech"]["support"] == [4120, 4140], "tech support")
    _assert(ctx["riskReward"]["price"] == 4163.9, "rr price")
    _assert(len(ctx["action"]["plans"]) == 2, "action plans")
    _assert(len(ctx["headlines"]) == 1, "headlines")
    log("INFO", "context assembly test passed")

    # 3. Test Response Parsing & Validation
    test_price = 4163.90
    valid_payload = mock_payload_for_doc(mock_test_doc)
    v_tech = validate_and_sanitize_tech(valid_payload["tech"], test_price, clamp=False)
    _assert(v_tech is not None, "valid tech should pass validation")
    _assert(v_tech["support"][0] < v_tech["support"][1] < test_price, "support < price")
    _assert(test_price < v_tech["resistance"][0] < v_tech["resistance"][1], "resistance > price")

    v_rr = validate_and_sanitize_risk_reward(valid_payload["riskReward"], test_price, clamp=False)
    _assert(v_rr is not None, "valid riskReward should pass validation")
    _assert(v_rr["stop"] < v_rr["support"] < test_price < v_rr["resistance"], "stop < support < price < resistance")

    v_macro = validate_and_sanitize_macro(valid_payload["macro_updates"])
    _assert(v_macro is not None and len(v_macro) == 5, "valid macro updates")

    v_action = validate_and_sanitize_action(valid_payload["action"])
    _assert(v_action is not None and len(v_action["plans"]) == 2, "valid action")

    v_footer = validate_and_sanitize_footer(valid_payload["footer"])
    _assert(v_footer is not None and len(v_footer) > 30, "valid footer")
    log("INFO", "response parsing & validation test passed")

    # 4. Test Safety Bounds & Self-Healing Defense
    # 4a. Support >= price:
    bad_rr_sup = {
        "support": 4180.0,  # > price (4163.9)
        "resistance": 4220.0,
        "stop": 4100.0,
        "src": "测试依据",
    }
    _assert(validate_and_sanitize_risk_reward(bad_rr_sup, test_price, clamp=False) is None, "clamp=False must reject support > price")
    healed_rr_sup = validate_and_sanitize_risk_reward(bad_rr_sup, test_price, clamp=True)
    _assert(healed_rr_sup is not None, "clamp=True must heal support > price")
    _assert(healed_rr_sup["support"] < test_price, "healed support must be < price")
    _assert(healed_rr_sup["stop"] < healed_rr_sup["support"], "healed stop must be < support")

    # 4b. Resistance <= price:
    bad_rr_res = {
        "support": 4120.0,
        "resistance": 4150.0,  # < price (4163.9)
        "stop": 4090.0,
        "src": "测试依据",
    }
    _assert(validate_and_sanitize_risk_reward(bad_rr_res, test_price, clamp=False) is None, "clamp=False must reject resistance < price")
    healed_rr_res = validate_and_sanitize_risk_reward(bad_rr_res, test_price, clamp=True)
    _assert(healed_rr_res is not None, "clamp=True must heal resistance < price")
    _assert(healed_rr_res["resistance"] > test_price, "healed resistance must be > price")

    # 4c. Stop >= support:
    bad_rr_stop = {
        "support": 4120.0,
        "resistance": 4220.0,
        "stop": 4130.0,  # > support (4120)
        "src": "测试依据",
    }
    _assert(validate_and_sanitize_risk_reward(bad_rr_stop, test_price, clamp=False) is None, "clamp=False must reject stop > support")
    healed_rr_stop = validate_and_sanitize_risk_reward(bad_rr_stop, test_price, clamp=True)
    _assert(healed_rr_stop is not None, "clamp=True must heal stop > support")
    _assert(healed_rr_stop["stop"] < healed_rr_stop["support"], "healed stop must be < support")

    # 4d. Tech support >= price:
    bad_tech_sup = {
        "support": [4180.0, 4200.0],  # > price (4163.9)
        "resistance": [4250.0, 4280.0],
        "trend": "测试趋势说明足够长度的文本内容...",
        "supportDesc": "测试支撑说明足够长度...",
        "resistanceDesc": "测试阻力说明足够长度...",
    }
    _assert(validate_and_sanitize_tech(bad_tech_sup, test_price, clamp=False) is None, "clamp=False must reject tech support > price")
    healed_tech_sup = validate_and_sanitize_tech(bad_tech_sup, test_price, clamp=True)
    _assert(healed_tech_sup is not None, "clamp=True must heal tech support > price")
    _assert(healed_tech_sup["support"][0] < healed_tech_sup["support"][1] < test_price, "healed tech support must be < price")

    # 4e. Absurd values must be rejected:
    _assert(validate_and_sanitize_risk_reward({"support": -10, "resistance": 4200, "stop": -20, "src": "abc"}, test_price) is None, "negative price must reject")
    _assert(validate_and_sanitize_risk_reward({"support": "abc", "resistance": 4200, "stop": 4000, "src": "abc"}, test_price) is None, "non-numeric must reject")
    _assert(validate_and_sanitize_tech("invalid", test_price) is None, "non-dict must reject")
    log("INFO", "safety bounds and self-healing clamping test passed")

    # 5. Test Data Preservation of Unmanaged Fields
    with GOLD_PATH.open(encoding="utf-8") as handle:
        live_gold_doc = json.load(handle)
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as tmp:
        json.dump(live_gold_doc, tmp, ensure_ascii=False)
        test_file = Path(tmp.name)

    try:
        # Save snapshot of all unmanaged structures
        orig_snapshot = live_gold_doc.get("snapshot")
        orig_metrics = json.dumps(live_gold_doc.get("metrics"), sort_keys=True)
        orig_candles = json.dumps(live_gold_doc.get("tech", {}).get("candles"), sort_keys=True)
        orig_volume = json.dumps(live_gold_doc.get("tech", {}).get("volume"), sort_keys=True)
        orig_momentum = json.dumps(live_gold_doc.get("tech", {}).get("momentum"), sort_keys=True)
        orig_support = live_gold_doc.get("tech", {}).get("support")
        orig_tech_note = live_gold_doc.get("tech", {}).get("note")
        orig_positioning = json.dumps(live_gold_doc.get("positioning"), sort_keys=True)
        orig_etf = json.dumps(live_gold_doc.get("etf"), sort_keys=True)
        orig_ssi = json.dumps(live_gold_doc.get("sentiment", {}).get("ssi"), sort_keys=True)
        orig_rr_price = live_gold_doc.get("sentiment", {}).get("riskReward", {}).get("price")
        orig_action_sec = live_gold_doc.get("action", {}).get("secTitle")

        # Run pipeline with a new payload
        new_payload = {
            "tech": {
                "support": [4110, 4130],
                "resistance": [4210, 4230],
                "trend": "测试新趋势：现货在 4163.90 一线整固，日 K 线处于探底回升观察阶段。",
                "supportDesc": "4110–4130：关键整数关口与前序波段底部支撑。",
                "resistanceDesc": "4210–4230：上方第一道密集成交受压平台。",
            },
            "riskReward": {
                "support": 4130,
                "resistance": 4210,
                "stop": 4080,
                "src": "测试新盈亏比依据：支撑取 4130，压力取 4210",
            },
            "macro_updates": [
                {
                    "k": "美债 10 年期收益率",
                    "v": "更新后的美债研判：10 年期收益率震荡走平，对金价压制稍有缓解。",
                    "signal": "flat",
                    "signalText": "边际缓和",
                }
            ],
            "action": {
                "summary": "更新后的行动纲要：现货在关键位盘整，短线防守，中线分批观察。",
                "plans": [
                    {
                        "who": "短线交易者",
                        "stance": "防守观望",
                        "action": "在 4130 一线寻找企稳信号，不盲目追空也不贸然左侧抄底。",
                    },
                    {
                        "who": "中长线 / 波段交易者",
                        "stance": "保持耐心",
                        "action": "继续跟踪美债长端利率见顶信号，维持战略定力。",
                    },
                ],
            },
            "footer": "更新后的页脚声明：伦敦金现货基准快照，仅供研讨参考。",
        }

        # Dry-run test: ensure dry-run does not write
        status_dry = refresh_gold_timeline(
            dry_run=True,
            data_path=test_file,
            headlines=sample_headlines,
            model_payload=new_payload,
        )
        _assert(status_dry == 0, "dry-run exit code 0")
        doc_after_dry = json.loads(test_file.read_text(encoding="utf-8"))
        _assert(doc_after_dry.get("tech", {}).get("support") == orig_support, "dry-run must not write to file")

        # Full run test
        status_real = refresh_gold_timeline(
            dry_run=False,
            data_path=test_file,
            headlines=sample_headlines,
            model_payload=new_payload,
        )
        _assert(status_real == 0, "real run exit code 0")
        doc_written = json.loads(test_file.read_text(encoding="utf-8"))

        # Verify unmanaged fields preservation
        _assert(doc_written.get("snapshot") == orig_snapshot, "snapshot must be preserved")
        _assert(json.dumps(doc_written.get("metrics"), sort_keys=True) == orig_metrics, "metrics must be preserved")
        _assert(json.dumps(doc_written.get("tech", {}).get("candles"), sort_keys=True) == orig_candles, "tech.candles must be preserved")
        _assert(json.dumps(doc_written.get("tech", {}).get("volume"), sort_keys=True) == orig_volume, "tech.volume must be preserved")
        _assert(json.dumps(doc_written.get("tech", {}).get("momentum"), sort_keys=True) == orig_momentum, "tech.momentum must be preserved")
        _assert(doc_written.get("tech", {}).get("note") == orig_tech_note, "tech.note must be preserved")
        _assert(json.dumps(doc_written.get("positioning"), sort_keys=True) == orig_positioning, "positioning must be preserved")
        _assert(json.dumps(doc_written.get("etf"), sort_keys=True) == orig_etf, "etf must be preserved")
        _assert(json.dumps(doc_written.get("sentiment", {}).get("ssi"), sort_keys=True) == orig_ssi, "sentiment.ssi must be preserved")
        _assert(doc_written.get("sentiment", {}).get("riskReward", {}).get("price") == orig_rr_price, "sentiment.riskReward.price must be preserved")
        _assert(doc_written.get("action", {}).get("secTitle") == orig_action_sec, "action.secTitle must be preserved")

        # Verify updated fields
        _assert(doc_written["tech"]["support"] == [4110, 4130], "tech.support updated")
        _assert(doc_written["tech"]["resistance"] == [4210, 4230], "tech.resistance updated")
        _assert("测试新趋势" in doc_written["tech"]["trend"], "tech.trend updated")
        _assert(doc_written["sentiment"]["riskReward"]["support"] == 4130, "rr.support updated")
        _assert(doc_written["sentiment"]["riskReward"]["resistance"] == 4210, "rr.resistance updated")
        _assert(doc_written["sentiment"]["riskReward"]["stop"] == 4080, "rr.stop updated")
        _assert(doc_written["action"]["summary"].startswith("更新后的行动纲要"), "action.summary updated")
        _assert(doc_written["footer"] == new_payload["footer"], "footer updated")

        # Verify macro item update
        updated_us10y = next((it for it in doc_written["macro"]["items"] if "美债" in it["k"]), None)
        _assert(updated_us10y is not None and updated_us10y["signal"] == "flat", "macro us10y signal updated")
        _assert(updated_us10y["signalText"] == "边际缓和", "macro us10y signalText updated")
        _assert("更新后的美债研判" in updated_us10y["v"], "macro us10y v updated")
        # Ensure quote and dim in macro item were preserved!
        _assert("quote" in updated_us10y and "dim" in updated_us10y, "macro item quote/dim preserved")

        # Test invalid payload rejection
        bad_run = refresh_gold_timeline(
            dry_run=False,
            data_path=test_file,
            headlines=sample_headlines,
            model_payload={"invalid": "payload"},
        )
        _assert(bad_run == 0, "bad payload returns 0")
        doc_after_bad = json.loads(test_file.read_text(encoding="utf-8"))
        _assert(doc_after_bad == doc_written, "bad payload leaves file untouched")

        log("INFO", "data updating and unmanaged fields preservation test passed")
    finally:
        test_file.unlink(missing_ok=True)

    log("INFO", "ALL self-test checks passed successfully!")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Refresh MarketTracker gold cognitive narrative.")
    parser.add_argument("--dry-run", action="store_true", help="Fetch and process without writing JSON")
    parser.add_argument("--self-test", action="store_true", help="Run offline self-test and exit")
    args = parser.parse_args()

    if args.self_test:
        return self_test()
    return refresh_gold_timeline(dry_run=args.dry_run)


if __name__ == "__main__":
    sys.exit(main())
