# 数据归属与自动化更新契约

本规范定义 MarketTracker 中自动化采集程序（GitHub Actions）与人工/智能代理（Agent）的数据权责边界，确保系统在持续自动化刷新过程中不发生字段覆盖、伪造行情或数据结构污染。

---

## 1. 权责划分原则

系统采用**职责严格分离（Separation of Concerns）**模式：
- **自动化流水线（GitHub Actions）**：负责实时/周期性高频数值、时序曲线、收盘行情与交易所衍生指标的自动采集与写入。
- **分析代理（Agent / Manual）**：负责产业背景、驱动逻辑、风险雷达、周期判断等分析性叙事字段的结构化编排与更新。
- **隔离纪律**：分析代理不得篡改自动化采集程序所属的数值键，除非用户明确要求变更底层数据结构。数值脚本不改写叙事字段。原油时间轴、黄金认知研判与科技宏观产业链研判是例外：分别由 `scripts/refresh_oil_timeline.py`、`scripts/refresh_gold_timeline.py` 与 `scripts/refresh_tech_semi_timeline.py` 自动化维护相关研判字段。

---

## 2. 自动化采集流水线（GitHub Actions 负责）

### 2.1 原油与黄金基准行情 (`scripts/refresh_market_data.py`)
- **工作流**：`.github/workflows/refresh-market-data.yml` (每小时 `0 * * * *`)
- **受保护文件与字段**：
  - `src/data/oilData.json`
    - `snapshot`
    - `metrics.main.num`、`metrics.main.chg`、`metrics.main.chgClass`、`metrics.main.src`
    - `metrics.main.quotes.wti`、`metrics.main.quotes.dxy`
    - `charts.dates`、`charts.wti`、`charts.brent`、`charts.wtiHigh`、`charts.brentHigh`
    - `charts.sc`（仅对齐交易日占位，不覆盖已核实的 SC 收盘价）
  - `src/data/goldData.json`
    - `snapshot`
    - `metrics.main.num`、`metrics.main.chg`、`metrics.main.chgClass`、`metrics.main.src`
    - `metrics.main.quotes.gc`、`metrics.main.quotes.dxy`
    - `tech.candles`、`tech.volume`
    - `tech.momentum` 中的 `近 20 交易日`、`近 5 交易日`、`今日现货` 的 `v` 字段
    - `sentiment.riskReward.price`
    - `positioning.table` 中以 `期现基差` 起始的行（`v`、`wk`、`gc`、`spot`、`basis`、`dir`、`src`）
    - `macro.items` 中以 `美元指数` 或 `美债 10 年期收益率` 为 key 的 `quote`（`value`、`bp`、`asOf`）
    *(注：黄金的技术支撑阻力、盈亏比区间、研判叙述由 `scripts/refresh_gold_timeline.py` 维护，见 §2.5)*

### 2.2 科技半导体基准行情 (`scripts/refresh_tech_semi_data.py`)
- **工作流**：`.github/workflows/refresh-market-data.yml` (每小时 `0 * * * *`)
- **受保护文件与字段**：
  - `src/data/techSemiData.json`
    - `snapshot`
    - `benchmarks.sox`、`benchmarks.kospi`、`benchmarks.star50`（各标的的 `price`、`chg`、`chgClass`、`previousClose`、`src`）
    - `charts.normalized`（`dates`、`sox`、`kospi`、`star50` 近半年标准化序列）
    - `leverage.marginBuyShare`（`value`、`asOf`、`buyYi`、`marketAmountYi`、`zone`、`v`、`status`、`src`、`dates`、`shares`）

### 2.3 A 股 TMT 行业拥挤度 (`scripts/refresh_tech_semi_crowding.py`)
- **工作流**：`.github/workflows/refresh-tech-semi-crowding.yml` (工作日周一至周五 07:30 UTC / 15:30 上海收盘)
- **受保护文件与字段**：
  - `src/data/techSemiData.json`
    - `crowding.asOf`、`crowding.label`、`crowding.zone`、`crowding.methodNote`、`crowding.src`
    - `crowding.turnoverShare`（`value`、`tmtAmountYi`、`marketAmountYi`、`label`、`unit`、`desc`）

### 2.4 原油时间轴与认知分析 (`scripts/refresh_oil_timeline.py`)
- **工作流**：`refresh-market-data.yml` 在原油报价（现价、涨跌、WTI、美元指数）相对上一版发生变化后立刻调用本脚本；`refresh-oil-timeline.yml` 仍在每日 00:30 与 12:30 UTC 再跑一次，覆盖报价未动但出现新快讯的时段。
- **架构详解与 Mermaid 流程图**：详见 [`docs/oil/pipeline.md`](oil/pipeline.md)。
- **密钥**：仓库 Secret `DS_API_KEY`（DeepSeek）
- **写入范围**：只改 `src/data/oilData.json` 的 `timeline`、`signal`、`risks`、`risksTitle`。抓取失败、模型失败或字段校验失败时不写文件。
- **不写**：`snapshot`、`metrics`、`charts`、`news`、`footer`。时间轴条目的 `url` 只能来自当次抓取的原文链接。

### 2.5 黄金认知分析与交易研判 (`scripts/refresh_gold_timeline.py`)
- **工作流**：`refresh-market-data.yml` 在黄金盘面报价（现货价、涨跌幅、COMEX GC、美元指数、美债 10 年期收益率及基点变化）相对上一版发生变动后联动调用本脚本；`refresh-gold-timeline.yml` 仍在每日 00:30 与 12:30 UTC 再跑一次，覆盖报价未动但资讯更新的时段。
- **架构详解与 Mermaid 流程图**：详见 [`docs/gold/pipeline.md`](gold/pipeline.md)。
- **密钥**：仓库 Secret `DS_API_KEY`（DeepSeek）
- **写入范围**：维护 `src/data/goldData.json` 的 `tech.support`、`tech.resistance`、`tech.trend`、`supportDesc`、`resistanceDesc`、`sentiment.riskReward`（`support`、`resistance`、`stop`、`src`）、`macro.items` 中的研判属性（`v`、`signal`、`signalText`）、`action` 以及 `footer`。抓取失败、模型失败或字段校验失败时不写文件。
- **不写**：`snapshot`、`metrics`、`tech.candles`、`tech.volume`、`tech.momentum`、`sentiment.riskReward.price`、`positioning.table`（期现基差行）。

### 2.6 ENSO 厄尔尼诺气候数值 (`scripts/refresh_enso_data.py`)
- **工作流**：`.github/workflows/refresh-enso-data.yml` (每日 07:15 与 19:15 UTC)
- **受保护文件与字段**：
  - `src/data/ensoData.json`
    - `cpc.asOf`
    - `cpc.traditional.*`（`weekly`、`monthly`、`oni`）
    - `cpc.relative.*`（`weekly`、`monthly`、`rnino34`、`roni`）

### 2.7 科技宏观认知分析与产业链研判 (`scripts/refresh_tech_semi_timeline.py`)
- **工作流**：`refresh-market-data.yml` 在科技半导体核心报价与拥挤度相对上一版发生变动后联动调用本脚本；`refresh-tech-semi-timeline.yml` 仍在每日 00:30 与 12:30 UTC 再跑一次，覆盖报价横盘但产业链资讯更新的时段。
- **架构详解与 Mermaid 流程图**：详见 [`docs/tech-semi/pipeline.md`](tech-semi/pipeline.md)。
- **密钥**：仓库 Secret `DS_API_KEY`（DeepSeek）
- **写入范围**：维护 `src/data/techSemiData.json` 的 `timeline`、`signal`、`risks`。抓取失败、模型失败或字段校验失败时不写文件。
- **不写**：`snapshot`、`head`、`benchmarks`、`charts`、`crowding`、`leverage`、`anomalies`、`fundamental`、`news`、`footer`。时间轴条目的 `url` 只能来自当次抓取的原文链接。

---

## 3. 分析代理职责（Agent 负责）

分析代理负责定性叙述、宏观联动解析、产业链模型及研究结论：
- **原油 (`oilData.json`)**：`head`、`news`、图表副标题、`metrics.main.refs`。`timeline`、`signal`、`risks` 由 `refresh_oil_timeline.py` 按最新报价与快讯维护，人工修订仍可直接改这些字段。页面不再展示 `news`。
- **黄金 (`goldData.json`)**：`head`、`tech.note`、持仓结构说明、ETF 资金流向、情绪说明等基础背景。`tech.support`、`tech.resistance`、`tech.trend`、`supportDesc`、`resistanceDesc`、`sentiment.riskReward`（`support`、`resistance`、`stop`、`src`）、`action` 与 `footer` 由 `scripts/refresh_gold_timeline.py` 在报价变动或定时分析时通过 DeepSeek 模型自动化维护，人工修订仍可直接改这些字段。
- **科技半导体宏观 (`techSemiData.json`)**：`head`、`anomalies`、`leverage.note`、`leverage.marginBuyShare` 的标签定义、`fundamental` 云厂商资本开支项、`news`、`footer`。`signal`、`timeline` 与 `risks` 由 `scripts/refresh_tech_semi_timeline.py` 在报价变动或定时分析时通过 DeepSeek 模型自动化维护，人工修订仍可直接改这些字段。
- **半导体设备材料 (`equipData.json`)**：`head`、`items`、`footer`。订单能见度与交期披露需带发布日期与来源，无官方披露保持「未接入」。
- **光模块 (`opticsData.json`)**：`head`、`rate`、`names`、`investorSummary`、`riskRadar`、`industryDriver`、`bomBreakdown`、`techMatrix`、`tripleCycle`、`competition`、`valuation`、`footer`。开支方向只引用 `/semi` 同一读数，不另造宏观数据。
- **ENSO 影响评估 (`ensoData.json`)**：`lastUpdated`、`head`、`anchor`、`impactTree`、`cropRegions`、`commodityOutlook`、`timeline`、`editions`、`footer`。农产品指标无可靠来源时标示「未接入」。

---

## 4. 容错与回退纪律

1. **缺失回退而非伪造空值**：数据抓取失败或接口异常时，保持上一周期有效数值并记录日志，严禁写入 `null` 或假数据假充最新行情。
2. **多序列隔离**：传统指数与相对指数严格分立字段，禁止混合存储。
3. **未接入状态统一**：无权威统计披露的产业指标严格标注为 `未接入`，杜绝臆造。
