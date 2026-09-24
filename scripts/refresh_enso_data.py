#!/usr/bin/env python3
"""Refresh ENSO numeric slots from NOAA CPC machine-readable index files.

Traditional and relative indices never share a field. Editions, timeline,
views, and other narrative text in ``ensoData.json`` are not rewritten.
A slot is replaced only when the file contains a strictly newer finished
center-week, month, or season. The same period is left alone even if the
anomaly was revised. Unfinished weeks and months are not invented.

Sources (CPC indices directory, plain text only):

* https://www.cpc.ncep.noaa.gov/data/indices/wksst9120.for
* https://www.cpc.ncep.noaa.gov/data/indices/rel_wksst9120.txt
* https://www.cpc.ncep.noaa.gov/data/indices/sstoi.indices
* https://www.cpc.ncep.noaa.gov/data/indices/rel_mthsst9120.txt
* https://www.cpc.ncep.noaa.gov/data/indices/Rnino34.ascii.txt
* https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt
* https://www.cpc.ncep.noaa.gov/data/indices/RONI.ascii.txt
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import tempfile
import urllib.error
import urllib.request
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENSO_PATH = ROOT / "src" / "data" / "ensoData.json"
CPC = "https://www.cpc.ncep.noaa.gov/data/indices"
UA = "Mozilla/5.0 (compatible; MarketTrackerEnso/1.0; +https://github.com/daiwanxing/MarketTracker)"

SOURCES = {
    "traditional_weekly": f"{CPC}/wksst9120.for",
    "relative_weekly": f"{CPC}/rel_wksst9120.txt",
    "traditional_monthly": f"{CPC}/sstoi.indices",
    "relative_monthly": f"{CPC}/rel_mthsst9120.txt",
    "rnino34": f"{CPC}/Rnino34.ascii.txt",
    "oni": f"{CPC}/oni.ascii.txt",
    "roni": f"{CPC}/RONI.ascii.txt",
}

# Traditional slots and relative slots are disjoint on purpose.
SLOT_PATHS = {
    "traditional_weekly": ("traditional", "weekly"),
    "traditional_monthly": ("traditional", "monthly"),
    "oni": ("traditional", "oni"),
    "relative_weekly": ("relative", "weekly"),
    "relative_monthly": ("relative", "monthly"),
    "rnino34": ("relative", "rnino34"),
    "roni": ("relative", "roni"),
}

SEASONS = ("DJF", "JFM", "FMA", "MAM", "AMJ", "MJJ", "JJA", "JAS", "ASO", "SON", "OND", "NDJ")
# (end month, year offset from the season label). NDJ of year Y ends in January Y+1.
SEASON_END = {
    "DJF": (2, 0),
    "JFM": (3, 0),
    "FMA": (4, 0),
    "MAM": (5, 0),
    "AMJ": (6, 0),
    "MJJ": (7, 0),
    "JJA": (8, 0),
    "JAS": (9, 0),
    "ASO": (10, 0),
    "SON": (11, 0),
    "OND": (12, 0),
    "NDJ": (1, 1),
}
_MONTHS = {
    "JAN": 1,
    "FEB": 2,
    "MAR": 3,
    "APR": 4,
    "MAY": 5,
    "JUN": 6,
    "JUL": 7,
    "AUG": 8,
    "SEP": 9,
    "OCT": 10,
    "NOV": 11,
    "DEC": 12,
}
_WEEK_ROW = re.compile(r"^\s*(\d{1,2}[A-Za-z]{3}\d{4})\s+(\S.*?)\s*$")
_DECIMAL = re.compile(r"-?\d+\.\d+")


def log(level: str, message: str) -> None:
    print(f"{level} {message}", flush=True)


def anomaly_ok(value: float) -> bool:
    return -8.0 <= value <= 8.0


def sst_ok(value: float) -> bool:
    return 15.0 <= value <= 35.0


def week_finished(center: date, today: date) -> bool:
    """A CPC week is centered on Wednesday and runs through the following Saturday."""
    return center + timedelta(days=3) < today


def month_end(year: int, month: int) -> date:
    if month == 12:
        return date(year, 12, 31)
    return date(year, month + 1, 1) - timedelta(days=1)


def month_finished(year: int, month: int, today: date) -> bool:
    return month_end(year, month) < today


def season_end(season: str, year: int) -> date:
    month, offset = SEASON_END[season]
    end_year = year + offset
    if month == 12:
        return date(end_year, 12, 31)
    return date(end_year, month + 1, 1) - timedelta(days=1)


def season_finished(season: str, year: int, today: date) -> bool:
    return season_end(season, year) < today


def parse_cpc_date(token: str) -> date | None:
    match = re.fullmatch(r"(\d{1,2})([A-Za-z]{3})(\d{4})", token.strip())
    if not match:
        return None
    month = _MONTHS.get(match.group(2).upper())
    if month is None:
        return None
    try:
        return date(int(match.group(3)), month, int(match.group(1)))
    except ValueError:
        return None


def _decimals(text: str) -> list[float]:
    return [float(piece) for piece in _DECIMAL.findall(text)]


def newest(rows: list[dict], key) -> dict | None:
    if not rows:
        return None
    return max(enumerate(rows), key=lambda pair: (key(pair[1]), pair[0]))[1]


def parse_traditional_weekly(text: str, today: date) -> dict | None:
    """OISST weekly. Eight SST/SSTA numbers; Niño3.4 anomaly is the 6th."""
    rows: list[dict] = []
    for line in text.splitlines():
        match = _WEEK_ROW.match(line)
        if not match:
            continue
        center = parse_cpc_date(match.group(1))
        nums = _decimals(match.group(2))
        if center is None or len(nums) != 8 or not week_finished(center, today):
            continue
        nino34_sst, nino34 = nums[4], nums[5]
        if not sst_ok(nino34_sst) or not anomaly_ok(nino34):
            continue
        rows.append(
            {
                "centerDate": center.isoformat(),
                "nino34": nino34,
                "nino34Sst": nino34_sst,
                "sourceUrl": SOURCES["traditional_weekly"],
            }
        )
    return newest(rows, lambda row: row["centerDate"])


def parse_relative_weekly(text: str, today: date) -> dict | None:
    """Relative weekly. Exactly four anomalies: Niño1+2, Niño3, Niño3.4, Niño4."""
    rows: list[dict] = []
    for line in text.splitlines():
        match = _WEEK_ROW.match(line)
        if not match:
            continue
        center = parse_cpc_date(match.group(1))
        nums = _decimals(match.group(2))
        # A traditional row has eight decimals and must not parse as relative.
        if center is None or len(nums) != 4 or not week_finished(center, today):
            continue
        nino34 = nums[2]
        if not anomaly_ok(nino34):
            continue
        rows.append(
            {
                "centerDate": center.isoformat(),
                "nino34": nino34,
                "sourceUrl": SOURCES["relative_weekly"],
            }
        )
    return newest(rows, lambda row: row["centerDate"])


def parse_traditional_monthly(text: str, today: date) -> dict | None:
    """sstoi.indices. Niño3.4 anomaly is the last column, not Niño3."""
    rows: list[dict] = []
    for line in text.splitlines():
        parts = line.split()
        if len(parts) != 10 or not re.fullmatch(r"\d{4}", parts[0]):
            continue
        year, month = int(parts[0]), int(parts[1])
        if not 1 <= month <= 12 or not month_finished(year, month, today):
            continue
        try:
            nino34 = float(parts[9])
        except ValueError:
            continue
        if not anomaly_ok(nino34):
            continue
        rows.append(
            {
                "year": year,
                "month": month,
                "nino34": nino34,
                "sourceUrl": SOURCES["traditional_monthly"],
            }
        )
    return newest(rows, lambda row: (row["year"], row["month"]))


def parse_relative_monthly(text: str, today: date) -> dict | None:
    """rel_mthsst9120. Columns are rNiño1+2, rNiño3, rNiño4, rNiño3.4."""
    rows: list[dict] = []
    for line in text.splitlines():
        parts = line.split()
        if len(parts) != 6 or not re.fullmatch(r"\d{4}", parts[0]):
            continue
        year, month = int(parts[0]), int(parts[1])
        if not 1 <= month <= 12 or not month_finished(year, month, today):
            continue
        try:
            nino34 = float(parts[5])
        except ValueError:
            continue
        if not anomaly_ok(nino34):
            continue
        rows.append(
            {
                "year": year,
                "month": month,
                "nino34": nino34,
                "sourceUrl": SOURCES["relative_monthly"],
            }
        )
    return newest(rows, lambda row: (row["year"], row["month"]))


def parse_rnino34(text: str, today: date) -> dict | None:
    rows: list[dict] = []
    for line in text.splitlines():
        parts = line.split()
        if len(parts) != 3 or not re.fullmatch(r"\d{4}", parts[0]):
            continue
        year, month = int(parts[0]), int(parts[1])
        if not 1 <= month <= 12 or not month_finished(year, month, today):
            continue
        try:
            value = float(parts[2])
        except ValueError:
            continue
        if not anomaly_ok(value):
            continue
        rows.append(
            {
                "year": year,
                "month": month,
                "value": value,
                "sourceUrl": SOURCES["rnino34"],
            }
        )
    return newest(rows, lambda row: (row["year"], row["month"]))


def parse_oni(text: str, today: date) -> dict | None:
    """ONI anomaly is the last column. The total SST must not be stored as the anomaly."""
    rows: list[dict] = []
    for line in text.splitlines():
        parts = line.split()
        if len(parts) != 4 or parts[0] not in SEASONS:
            continue
        season, year_s, total_s, anom_s = parts
        try:
            year = int(year_s)
            total = float(total_s)
            value = float(anom_s)
        except ValueError:
            continue
        if not anomaly_ok(value) or not sst_ok(total) or not season_finished(season, year, today):
            continue
        rows.append(
            {
                "season": season,
                "year": year,
                "value": value,
                "sourceUrl": SOURCES["oni"],
            }
        )
    return newest(rows, lambda row: season_end(row["season"], row["year"]))


def parse_roni(text: str, today: date) -> dict | None:
    rows: list[dict] = []
    for line in text.splitlines():
        parts = line.split()
        if len(parts) != 3 or parts[0] not in SEASONS:
            continue
        season, year_s, anom_s = parts
        try:
            year = int(year_s)
            value = float(anom_s)
        except ValueError:
            continue
        if not anomaly_ok(value) or not season_finished(season, year, today):
            continue
        rows.append(
            {
                "season": season,
                "year": year,
                "value": value,
                "sourceUrl": SOURCES["roni"],
            }
        )
    return newest(rows, lambda row: season_end(row["season"], row["year"]))


PARSERS = {
    "traditional_weekly": parse_traditional_weekly,
    "relative_weekly": parse_relative_weekly,
    "traditional_monthly": parse_traditional_monthly,
    "relative_monthly": parse_relative_monthly,
    "rnino34": parse_rnino34,
    "oni": parse_oni,
    "roni": parse_roni,
}


def http_text(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/plain,*/*"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        raw = resp.read()
    text = raw.decode("utf-8", errors="replace")
    if text.lstrip().startswith("<"):
        raise RuntimeError(f"{url} returned HTML, not a CPC index file")
    if not text.strip():
        raise RuntimeError(f"{url} was empty")
    return text


def period_key(slot: dict) -> tuple:
    if "centerDate" in slot:
        return ("week", slot["centerDate"])
    if "season" in slot:
        return ("season", slot["season"], int(slot["year"]))
    return ("month", int(slot["year"]), int(slot["month"]))


def period_ord(period: tuple) -> int:
    kind = period[0]
    if kind == "week":
        return date.fromisoformat(period[1]).toordinal()
    if kind == "month":
        return date(period[1], period[2], 1).toordinal()
    return season_end(period[1], period[2]).toordinal()


def numeric_values(slot: dict) -> dict[str, float]:
    return {
        key: float(value)
        for key, value in slot.items()
        if isinstance(value, (int, float)) and not isinstance(value, bool)
    }


def slot_complete(slot: dict) -> bool:
    if not slot.get("sourceUrl") or not isinstance(slot["sourceUrl"], str):
        return False
    numbers = numeric_values(slot)
    if not numbers:
        return False
    if any(value != value or value in (float("inf"), float("-inf")) for value in numbers.values()):
        return False
    if "nino34" in slot and not anomaly_ok(float(slot["nino34"])):
        return False
    if "value" in slot and not anomaly_ok(float(slot["value"])):
        return False
    if "nino34Sst" in slot and not sst_ok(float(slot["nino34Sst"])):
        return False
    return True


def apply_parsed(cpc: dict, name: str, incoming: dict) -> bool:
    if not slot_complete(incoming):
        log("WARN", f"{name} left unchanged; parsed slot was incomplete")
        return False
    family, slot_name = SLOT_PATHS[name]
    family_obj = cpc.setdefault(family, {})
    if not isinstance(family_obj, dict):
        family_obj = {}
        cpc[family] = family_obj
    current = family_obj.get(slot_name)
    if not isinstance(current, dict) or not current:
        family_obj[slot_name] = incoming
        log("INFO", f"{name} initialized at {period_key(incoming)}")
        return True
    old_ord = period_ord(period_key(current))
    new_ord = period_ord(period_key(incoming))
    if new_ord < old_ord:
        log("WARN", f"{name} incoming period is older; left unchanged")
        return False
    if new_ord == old_ord:
        if numeric_values(current) != numeric_values(incoming):
            log("INFO", f"{name} same period {period_key(current)}; value differs, left unchanged")
        return False
    family_obj[slot_name] = incoming
    log("INFO", f"{name} advanced to {period_key(incoming)}")
    return True


def observation_date(slot: dict) -> date | None:
    if not isinstance(slot, dict) or not slot:
        return None
    if "centerDate" in slot:
        return date.fromisoformat(str(slot["centerDate"]))
    if "season" in slot and "year" in slot:
        return season_end(str(slot["season"]), int(slot["year"]))
    if "year" in slot and "month" in slot:
        return month_end(int(slot["year"]), int(slot["month"]))
    return None


def recompute_asof(cpc: dict) -> str | None:
    found: list[date] = []
    for family in ("traditional", "relative"):
        block = cpc.get(family) or {}
        if not isinstance(block, dict):
            continue
        for slot in block.values():
            obs = observation_date(slot)
            if obs is not None:
                found.append(obs)
    if not found:
        return None
    return max(found).isoformat()


def ordered_cpc(cpc: dict) -> dict:
    traditional = cpc.get("traditional") if isinstance(cpc.get("traditional"), dict) else {}
    relative = cpc.get("relative") if isinstance(cpc.get("relative"), dict) else {}
    out: dict = {}
    if cpc.get("asOf"):
        out["asOf"] = cpc["asOf"]
    out["traditional"] = {
        key: traditional[key]
        for key in ("weekly", "monthly", "oni")
        if isinstance(traditional.get(key), dict) and traditional[key]
    }
    out["relative"] = {
        key: relative[key]
        for key in ("weekly", "monthly", "rnino34", "roni")
        if isinstance(relative.get(key), dict) and relative[key]
    }
    return out


def dump_nested(value: dict) -> str:
    raw = json.dumps(value, ensure_ascii=False, indent=2)
    lines = raw.splitlines()
    if len(lines) == 1:
        return raw
    return lines[0] + "\n" + "\n".join("  " + line for line in lines[1:])


def match_json_value(text: str, start: int) -> int:
    i = start
    while i < len(text) and text[i].isspace():
        i += 1
    if i >= len(text) or text[i] != "{":
        raise ValueError("cpc value is not a JSON object")
    depth = 0
    in_str = False
    escape = False
    for j in range(i, len(text)):
        ch = text[j]
        if in_str:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return j + 1
    raise ValueError("unbalanced cpc object")


def upsert_cpc(text: str, cpc: dict) -> str:
    """Replace or insert the top-level cpc object without reformatting the rest of the file."""
    value = dump_nested(ordered_cpc(cpc))
    marker = '\n  "cpc": '
    idx = text.find(marker)
    if idx == -1:
        stripped = text.rstrip()
        if not stripped.endswith("}"):
            raise ValueError("ensoData.json is not a JSON object")
        body = stripped[:-1].rstrip()
        if not body.endswith(","):
            body += ","
        return body + f'\n  "cpc": {value}\n' + "}\n"
    end = match_json_value(text, idx + len(marker))
    return text[:idx] + f'\n  "cpc": {value}' + text[end:]


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def refresh(
    dry_run: bool = False,
    path: Path | None = None,
    texts: dict[str, str] | None = None,
    today: date | None = None,
) -> int:
    path = ENSO_PATH if path is None else path
    today = date.today() if today is None else today
    log("INFO", f"ENSO numeric refresh for finished rows on or before {today.isoformat()}")
    original = path.read_text(encoding="utf-8")
    data = json.loads(original)
    cpc = data.get("cpc")
    if not isinstance(cpc, dict):
        cpc = {}
        data["cpc"] = cpc

    parsed_any = False
    failures: list[str] = []
    changed = False
    for name, url in SOURCES.items():
        try:
            text = texts[name] if texts is not None else http_text(url)
            parsed = PARSERS[name](text, today)
            if parsed is None:
                raise RuntimeError("no finished row")
        except (urllib.error.URLError, TimeoutError, OSError, RuntimeError, ValueError) as exc:
            failures.append(f"{name}: {exc}")
            log("WARN", f"{name} left unchanged: {exc}")
            continue
        parsed_any = True
        if apply_parsed(cpc, name, parsed):
            changed = True

    if not parsed_any:
        log("ERROR", "total failure: no CPC index file could be parsed")
        return 1
    if failures:
        log("WARN", "series with errors: " + " | ".join(failures))
    if changed:
        as_of = recompute_asof(cpc)
        if not as_of:
            log("WARN", "asOf left unchanged; no observation date")
        else:
            cpc["asOf"] = as_of
            log("INFO", f"asOf {as_of}")
    if not changed:
        log("INFO", "no newer CPC period; ensoData.json not written")
        return 0

    updated = upsert_cpc(original, cpc)
    # Narrative bytes ahead of the cpc key stay as they were.
    if dry_run:
        log("INFO", "dry-run: ensoData.json not written")
        return 0
    path.write_text(updated, encoding="utf-8")
    log("INFO", f"wrote {path.name}")
    written = json.loads(updated)
    _assert_families(written.get("cpc") or {})
    return 0


def _assert_families(cpc: dict) -> None:
    traditional = cpc.get("traditional") or {}
    relative = cpc.get("relative") or {}
    trad_paths = {f"traditional.{key}" for key in traditional}
    rel_paths = {f"relative.{key}" for key in relative}
    if trad_paths & rel_paths:
        raise RuntimeError(f"traditional and relative share slots: {trad_paths & rel_paths}")


def _assert(cond: bool, message: str) -> None:
    if not cond:
        raise AssertionError(message)


def self_test() -> int:
    trad_paths = {path for name, path in SLOT_PATHS.items() if name.startswith("traditional") or name == "oni"}
    rel_paths = {path for name, path in SLOT_PATHS.items() if path[0] == "relative"}
    _assert(trad_paths.isdisjoint(rel_paths), f"shared slot paths {trad_paths & rel_paths}")
    _assert(SLOT_PATHS["oni"] != SLOT_PATHS["roni"], "ONI and RONI must not share a slot")
    _assert(SLOT_PATHS["traditional_monthly"] != SLOT_PATHS["relative_monthly"], "monthly families differ")
    _assert(SLOT_PATHS["rnino34"] != SLOT_PATHS["relative_monthly"], "Rnino34 is not the relative monthly slot")

    today = date(2026, 9, 24)
    trad_text = """
 Weekly SST data starts week centered on 2Sept1981
                Nino1+2      Nino3        Nino34        Nino4
 Week          SST SSTA     SST SSTA     SST SSTA     SST SSTA
 09SEP2026     25.2 4.5     28.6 3.7     29.6 2.9     29.6 0.9
 16SEP2026     25.3 4.6     28.6 3.8     29.6 3.0     29.6 1.0
 23SEP2026     25.0 4.4     28.0 3.2     29.0 2.5     29.0 0.8
 02SEP1981     20.6-0.1     24.8-0.1     26.5-0.2     28.3-0.3
"""
    rel_text = """
                Nino1+2      Nino3      Nino34     Nino4
 Week             SSTA       SSTA       SSTA       SSTA
 09SEP2026         3.7        2.8        2.0       -0.1
 16SEP2026         3.9        3.0        2.1        0.0
 23SEP2026         3.5        2.6        1.9        0.1
"""
    # A bare month digit must not become Niño3.4. 11 has no decimal, so the row is ignored.
    month_digit = " 16SEP2026         11         3.0        2.1        0.0\n"
    trad = parse_traditional_weekly(trad_text, today)
    rel = parse_relative_weekly(rel_text, today)
    _assert(trad is not None and rel is not None, "weekly parsers")
    assert trad is not None and rel is not None
    _assert(trad["centerDate"] == "2026-09-16", trad["centerDate"])
    _assert(rel["centerDate"] == "2026-09-16", rel["centerDate"])
    _assert(trad["nino34"] == 3.0 and trad["nino34Sst"] == 29.6, trad)
    _assert(rel["nino34"] == 2.1, rel)
    _assert(trad["nino34"] != rel["nino34"], "same-week traditional +3.0 and relative +2.1 were swapped")
    _assert("nino34Sst" not in rel, "relative weekly must not carry a traditional SST")
    _assert(parse_relative_weekly(trad_text, today) is None, "traditional weekly text must not fill the relative slot")
    _assert(parse_traditional_weekly(rel_text, today) is None, "relative weekly text must not fill the traditional slot")
    _assert(parse_relative_weekly(month_digit, today) is None, "accidental month digit 11 is not a Niño anomaly")
    early = parse_traditional_weekly(trad_text, date(2026, 9, 18))
    _assert(early is not None and early["centerDate"] == "2026-09-09", early)
    glued = parse_traditional_weekly(" 02SEP1981     20.6-0.1     24.8-0.1     26.5-0.2     28.3-0.3\n", date(1981, 9, 10))
    _assert(glued is not None and glued["nino34"] == -0.2 and glued["nino34Sst"] == 26.5, glued)

    monthly_trad = """
YR MON  NINO1+2   ANOM   NINO3    ANOM   NINO4    ANOM NINO3.4    ANOM
2026   7   25.40    3.56   28.21    2.33   29.84    1.06   29.33    2.03
2026   8   24.93    4.08   28.35    3.13   29.63    0.93   29.42    2.52
2026   9   24.00    4.50   28.00    3.50   29.00    1.00   29.00    2.80
"""
    monthly_rel = """
YEAR  MON  rNINO1+2   rNINO3   rNINO4  rNINO3.4
2026    7      2.84     1.73     0.34      1.38
2026    8      3.35     2.52     0.12      1.78
2026    9      3.00     2.20     0.10      1.50
"""
    rnino = """
YR   MTH   ANOM
2026   8   1.67
2026   9   1.90
"""
    oni = """
 SEAS  YR   TOTAL   ANOM
  JJA 2026  29.09   1.80
  JAS 2026  29.20   1.95
"""
    roni = """
SEAS   YR  ANOM
JJA  2026  1.36
JAS  2026  1.50
"""
    trad_m = parse_traditional_monthly(monthly_trad, today)
    rel_m = parse_relative_monthly(monthly_rel, today)
    rn = parse_rnino34(rnino, today)
    oni_row = parse_oni(oni, today)
    roni_row = parse_roni(roni, today)
    _assert(trad_m is not None and trad_m["nino34"] == 2.52 and trad_m["month"] == 8, trad_m)
    _assert(rel_m is not None and rel_m["nino34"] == 1.78 and rel_m["month"] == 8, rel_m)
    _assert(trad_m["nino34"] != rel_m["nino34"], "monthly traditional 2.52 and relative 1.78 were swapped")
    _assert(rn is not None and rn["value"] == 1.67 and "nino34" not in rn, rn)
    _assert("value" not in rel_m, "relative monthly uses nino34, not the Rnino34 value field")
    _assert(oni_row is not None and oni_row["value"] == 1.80 and oni_row["season"] == "JJA", oni_row)
    _assert(roni_row is not None and roni_row["value"] == 1.36 and roni_row["season"] == "JJA", roni_row)
    _assert(oni_row["value"] != 29.09, "ONI total SST was stored as the anomaly")
    _assert(parse_roni(oni, today) is None, "ONI text must not fill RONI")
    _assert(parse_rnino34(roni, today) is None, "RONI text must not fill Rnino34")

    texts = {
        "traditional_weekly": trad_text,
        "relative_weekly": rel_text,
        "traditional_monthly": monthly_trad,
        "relative_monthly": monthly_rel,
        "rnino34": rnino,
        "oni": oni,
        "roni": roni,
    }
    narrative = (
        '{\n'
        '  "lastUpdated": "2026年9月24日",\n'
        '  "editions": [{ "title": "keep", "timeline": [{ "body": "传统 +3.0°C 相对 +2.1°C" }] }],\n'
        '  "footer": "keep"\n'
        '}\n'
    )
    tmp = Path(tempfile.mkdtemp()) / "ensoData.json"
    try:
        tmp.write_text(narrative, encoding="utf-8")
        dry = refresh(dry_run=True, path=tmp, texts=texts, today=today)
        _assert(dry == 0, f"dry-run exit {dry}")
        _assert(tmp.read_text(encoding="utf-8") == narrative, "dry-run does not write")
        wrote = refresh(dry_run=False, path=tmp, texts=texts, today=today)
        _assert(wrote == 0, f"write exit {wrote}")
        written_text = tmp.read_text(encoding="utf-8")
        _assert('"title": "keep"' in written_text and '"footer": "keep"' in written_text, "narrative kept")
        prefix = narrative.rstrip()[:-1].rstrip()
        _assert(written_text.startswith(prefix), "editions bytes unchanged")
        written = json.loads(written_text)
        cpc = written["cpc"]
        _assert(cpc["traditional"]["weekly"]["nino34"] == 3.0, cpc["traditional"]["weekly"])
        _assert(cpc["relative"]["weekly"]["nino34"] == 2.1, cpc["relative"]["weekly"])
        _assert(cpc["traditional"]["monthly"]["nino34"] == 2.52, "trad month")
        _assert(cpc["relative"]["monthly"]["nino34"] == 1.78, "rel month")
        _assert(cpc["relative"]["rnino34"]["value"] == 1.67, "rnino34")
        _assert(cpc["traditional"]["oni"]["value"] == 1.80, "oni")
        _assert(cpc["relative"]["roni"]["value"] == 1.36, "roni")
        _assert(cpc["asOf"] == "2026-09-16", cpc["asOf"])
        again = refresh(dry_run=False, path=tmp, texts=texts, today=today)
        _assert(again == 0, "second pass")
        _assert(tmp.read_text(encoding="utf-8") == written_text, "same week does not rewrite the file")

        drifted = dict(texts)
        drifted["traditional_weekly"] = trad_text.replace("29.6 3.0", "29.6 3.4", 1)
        drifted["relative_weekly"] = rel_text.replace("2.1", "2.4", 1)
        refresh(dry_run=False, path=tmp, texts=drifted, today=today)
        held = json.loads(tmp.read_text(encoding="utf-8"))
        _assert(held["cpc"]["traditional"]["weekly"]["nino34"] == 3.0, "same-week traditional revision ignored")
        _assert(held["cpc"]["relative"]["weekly"]["nino34"] == 2.1, "same-week relative revision ignored")

        newer = dict(texts)
        newer["traditional_weekly"] = """
 16SEP2026     25.3 4.6     28.6 3.8     29.6 3.0     29.6 1.0
 23SEP2026     25.4 4.7     28.7 3.9     29.7 3.1     29.7 1.1
"""
        newer["relative_weekly"] = """
 16SEP2026         3.9        3.0        2.1        0.0
"""
        refresh(dry_run=False, path=tmp, texts=newer, today=date(2026, 10, 1))
        advanced = json.loads(tmp.read_text(encoding="utf-8"))
        _assert(advanced["cpc"]["traditional"]["weekly"]["centerDate"] == "2026-09-23", "newer week")
        _assert(advanced["cpc"]["traditional"]["weekly"]["nino34"] == 3.1, "newer anomaly")
        _assert(advanced["cpc"]["relative"]["weekly"]["nino34"] == 2.1, "relative slot not copied from traditional")
        _assert(advanced["editions"][0]["title"] == "keep", "edition title")
    finally:
        tmp.unlink(missing_ok=True)
    log("INFO", "self-test passed")
    return 0


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Refresh MarketTracker ENSO CPC numeric slots.")
    parser.add_argument("--dry-run", action="store_true", help="Fetch and log updates without writing JSON")
    parser.add_argument("--self-test", action="store_true", help="Run offline checks and exit")
    args = parser.parse_args(argv)
    if args.self_test:
        return self_test()
    return refresh(dry_run=args.dry_run)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
