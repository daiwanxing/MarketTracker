# 数值字段归属

GitHub Actions 和云端代理改的不是同一类内容。云端代理不要覆盖 Actions 负责的数字键，除非用户明确要求改这些字段的结构。

## Actions 负责

原油和黄金：`scripts/refresh_market_data.py`，工作流 **Refresh market data**（每 3 小时）。不写 ENSO。

- `src/data/oilData.json`
  - `snapshot`
  - `metrics.main.num`、`metrics.main.chg`、`metrics.main.chgClass`、`metrics.main.src`
  - `metrics.main.quotes.wti`、`metrics.main.quotes.dxy`
  - `charts.dates`、`charts.wti`、`charts.brent`、`charts.wtiHigh`、`charts.brentHigh`
  - `charts.sc` 只在新增交易日时为了对齐补一个空位；脚本不会把空值当成已核实的 SC 收盘，也不会清掉已有的 SC
- `src/data/goldData.json`
  - `snapshot`
  - `metrics.main.num`、`metrics.main.chg`、`metrics.main.chgClass`、`metrics.main.src`
  - `metrics.main.quotes.gc`、`metrics.main.quotes.dxy`
  - `tech.candles`、`tech.volume`
  - `tech.momentum` 里这三行的 `v`：`近 20 交易日`、`近 5 交易日`、`今日现货`
  - `sentiment.riskReward.price`
  - `positioning.table` 中 `k` 以 `期现基差` 开头的那一行：`v`、`wk`、`gc`、`spot`、`basis`、`dir`、`src`（这几个一起写，避免只改 `v` 留下旧的周字段）
  - `macro.items` 里 `k` 为 `美元指数` 或 `美债 10 年期收益率` 的 `quote`

ENSO 数值：`scripts/refresh_enso_data.py`，工作流 **Refresh ENSO numbers**（每天 07:15 与 19:15 UTC）。只读 CPC 纯文本指数，不抓 HTML。传统和相对指数绝不共用字段。只有文件里出现更新的、并且已经结束的中心周、月份或季节时才提交。

- `src/data/ensoData.json` 的 `cpc`
  - `cpc.asOf`
  - `cpc.traditional.weekly`：`centerDate`、`nino34`、`nino34Sst`、`sourceUrl`（`wksst9120.for`）
  - `cpc.traditional.monthly`：`year`、`month`、`nino34`、`sourceUrl`（`sstoi.indices`）
  - `cpc.traditional.oni`：`season`、`year`、`value`、`sourceUrl`（`oni.ascii.txt`）
  - `cpc.relative.weekly`：`centerDate`、`nino34`、`sourceUrl`（`rel_wksst9120.txt`）
  - `cpc.relative.monthly`：`year`、`month`、`nino34`、`sourceUrl`（`rel_mthsst9120.txt`）
  - `cpc.relative.rnino34`：`year`、`month`、`value`、`sourceUrl`（`Rnino34.ascii.txt`）
  - `cpc.relative.roni`：`season`、`year`、`value`、`sourceUrl`（`RONI.ascii.txt`）

副序列失败或缺少昨收时，保留原来的数字并打 WARN。不要写入 null 或空字符串来冒充行情。

## 云端代理负责

信号正文、新闻、时间轴、观点，以及 ENSO 期次里的叙述。

- 原油：`head`、`signal`、`timeline`、`news`、`risks`、图表标题，以及 `metrics.main.refs`（叙述，不是实时报价）
- 黄金：`tech.trend`、`supportDesc`、`resistanceDesc`、`tech.note`、持仓说明、`macro.items[].v`、ETF、情绪文案、`action`
- ENSO：`lastUpdated`、`head`、`editions`（含 `metrics`、`timeline`、`views`）、`footer`

这些文字里可以出现数字，但不要改上面列出的 Actions 键，也不要把传统 Niño3.4 和相对 Niño3.4 写进同一个字段。
