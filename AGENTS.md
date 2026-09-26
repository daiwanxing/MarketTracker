# 数值字段归属

GitHub Actions 和云端代理改的不是同一类内容。云端代理不要覆盖 Actions 负责的数字键，除非用户明确要求改这些字段的结构。

## Actions 负责

原油、黄金与科技半导体：`scripts/refresh_market_data.py` 与 `scripts/refresh_tech_semi_data.py`，工作流 **Refresh market data**（每小时 `0 * * * *`）。不写 ENSO。

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
- `src/data/techSemiData.json`
  - `snapshot`
  - `benchmarks.sox`、`benchmarks.star50`、`benchmarks.chip_etf`（各序列的 `price`、`chg`、`chgClass`、`previousClose`、`src`）
  - `charts.normalized`：`dates`、`sox`、`star50`、`chip_etf`（近半年标准化收益走势 %）
  - `leverage.marginBuyShare`：`value`（最新交易日全市场融资买入额 / 同日上证+深证成指成交额 %）、`asOf`、`buyYi`、`marketAmountYi`、`zone`、`v`、`status`、`src`、`dates`、`shares`（近约 60 个交易日的占比序列，供折线）。`<7` 低于平常，`7–9` 平常，`>9` 高于平常。不写个股融资余额

科技半导体 A 股 TMT 真实拥挤度：`scripts/refresh_tech_semi_crowding.py`，工作流 **Refresh tech semi crowding**（工作日周一至周五 07:30 UTC / 15:30 上海时间收盘后）。

- `src/data/techSemiData.json` 的 `crowding`
  - `crowding.asOf`
  - `crowding.label`、`crowding.zone`、`crowding.methodNote`、`crowding.src`（按成交占比：`<20` 低位冰点，`20–32` 主线活跃，`32–38` 拥挤偏热，`≥38` 极端过热）
  - `crowding.turnoverShare`：`value`（申万电子+计算机+传媒+通信占沪深全市场成交额 %）、`tmtAmountYi`、`marketAmountYi`、`label`、`unit`、`desc`

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

信号正文、新闻、时间轴、观点，以及各板块与期次里的叙述。

- 原油：`head`、`signal`、`timeline`、`news`、`risks`、图表标题，以及 `metrics.main.refs`（叙述，不是实时报价）
- 黄金：`tech.trend`、`supportDesc`、`resistanceDesc`、`tech.note`、持仓说明、`macro.items[].v`、ETF、情绪文案、`action`
- 科技半导体：`head`、`signal`（含 `bull`、`bear`、`watch`）、`anomalies`、`leverage.note`、`leverage.marginBuyShare` 的 `k` / `metric` / `watch`、`fundamental`、`timeline`、`news`、`risks`、`footer`
- ENSO：`lastUpdated`、`head`、`anchor`、`impactTree`、`cropRegions`、`commodityOutlook`、`timeline`、`editions`（含 `metrics`、`timeline`、`views`）、`footer`。农产品产量、出口配额、库容、墒情分位和港口等待天数没有已发布材料时保持「未接入」

这些文字里可以出现数字，但不要改上面列出的 Actions 键，也不要把传统 Niño3.4 和相对 Niño3.4 写进同一个字段。不捏造虚假 A 股 TMT 成交占比或融资余额数据。`anomalies`、`fundamental` 里没有自动源的份额申赎、市场宽度、期权偏度、炸板率、CSP 资本开支、CoWoS 与 EPS 修订保持「未接入」，不要填未核实的数字。全市场融资买入占比只写 `leverage.marginBuyShare` 里 Actions 负责的数字，不另造核心股篮子。
