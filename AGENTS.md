# MarketTracker 代理架构地图与导航索引

本项目为基于纯静态数据驱动的专业级大宗商品与科技半导体行情决策看板（MarketTracker）。本文件充当智能代理（Agent）的代码库全景地图与任务路由索引，指导代理在执行不同工程任务时精准定位目标文件与规范文档。

---

## 1. 系统分层架构

```
┌─────────────────────────────────────────────────────────────┐
│ 1. 视图表现层 (Presentation Layer)                         │
│    src/components/*.tsx, src/styles/theme.css               │
├─────────────────────────────────────────────────────────────┤
│ 2. 数据契约层 (Data Contract Layer)                         │
│    src/data/*.json                                          │
├─────────────────────────────────────────────────────────────┤
│ 3. 自动化采集流水线 (Automation Pipeline)                   │
│    scripts/*.py, .github/workflows/*.yml                    │
├─────────────────────────────────────────────────────────────┤
│ 4. 治理与规范层 (Governance & Specifications)               │
│    docs/data-ownership.md, docs/editorial-guidelines.md     │
│    docs/oil/pipeline.md                                     │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. 业务板块导航矩阵 (Domain Routing Matrix)

代理在处理各业务板块时，请依据下表进行精准文件导航：

| 业务板块 | 视图组件 (Presentation) | 数据契约 (Data Contract) | 自动化脚本 (Automation) | CI/CD 工作流 (Workflow) |
| :--- | :--- | :--- | :--- | :--- |
| **原油 (Crude Oil)** | `src/components/OilPanel.tsx` | `src/data/oilData.json` | `scripts/refresh_market_data.py`<br>`scripts/refresh_oil_timeline.py` | `refresh-market-data.yml`（每小时；报价变动联动分析）<br>`refresh-oil-timeline.yml`（每日 2 次）<br>*(详见 [`docs/oil/pipeline.md`](docs/oil/pipeline.md))* |
| **黄金 (Gold)** | `src/components/GoldPanel.tsx` | `src/data/goldData.json` | `scripts/refresh_market_data.py` | `refresh-market-data.yml` (每小时) |
| **科技宏观 (Tech Semi)** | `src/components/TechSemiPanel.tsx` | `src/data/techSemiData.json` | `scripts/refresh_tech_semi_data.py`<br>`scripts/refresh_tech_semi_crowding.py` | `refresh-market-data.yml` (每小时)<br>`refresh-tech-semi-crowding.yml` (工作日) |
| **设备材料 (Equip)** | `src/components/EquipPanel.tsx` | `src/data/equipData.json` | *(手动/代理披露跟踪，无高频采集)* | — |
| **光模块 (Optics)** | `src/components/OpticsPanel.tsx` | `src/data/opticsData.json` | *(引用宏观页 Actions 与披露更新)* | — |
| **气象气候 (ENSO)** | `src/components/EnsoPanel.tsx` | `src/data/ensoData.json` | `scripts/refresh_enso_data.py` | `refresh-enso-data.yml` (每日 2 次) |

---

## 3. 规范与准则指引 (Governance Protocols)

代理在执行修改前，必须阅读并遵照下述专项规范：

- **数据所有权与自动化保护边界** ➔ 详见 [`docs/data-ownership.md`](docs/data-ownership.md)
  - 规定 GitHub Actions 负责维护的高频数值键白名单。
  - 规定代理严禁覆写数值字段及异常回退机制。
- **原油数据拉取与认知分析模型架构** ➔ 详见 [`docs/oil/pipeline.md`](docs/oil/pipeline.md)
  - 规定原油双轨流水线、DeepSeek 结构化研判链路、全景 Mermaid 图解与容错机制。
- **严肃机构投研叙事与文风纪律** ➔ 详见 [`docs/editorial-guidelines.md`](docs/editorial-guidelines.md)
  - 规定 Bloomberg Terminal / 顶级投行研报基准文风。
  - 规定口语俗语禁用词表、专业机构术语替换映射与事实来源标注规范。
- **视觉设计系统与 Design Tokens** ➔ 详见 [`src/styles/theme.css`](src/styles/theme.css)
  - 规定暗色高对比（SpaceX Design Token）、圆角规范（Sharp）、排版层级与颜色变量。

---

## 4. 代理任务执行协议 (Agent Task Protocols)

### 场景 A：更新产业研判、事件点评与文本分析
1. **查阅规范**：阅读 [`docs/editorial-guidelines.md`](docs/editorial-guidelines.md) 确认术语标准。
2. **定位目标**：根据导航矩阵定位至对应 `src/data/{domain}Data.json` 的叙述字段。
3. **执行约束**：仅更新叙事属性，严禁变更自动化脚本维护的数值结构。

### 场景 B：调整数据采集逻辑或扩展指标
1. **查阅规范**：阅读 [`docs/data-ownership.md`](docs/data-ownership.md) 确认权责归属与异常容错规则。
2. **定位目标**：修改对应 `scripts/refresh_*.py` 及其对应的 `.github/workflows/*.yml`。
3. **执行约束**：禁止伪造数据或返回 `null`，保持上一有效读数并输出日志警报。

### 场景 C：重构界面交互与数据可视化
1. **查阅规范**：查阅 [`src/styles/theme.css`](src/styles/theme.css) 遵循统一设计变量。
2. **定位目标**：修改对应 `src/components/{Domain}Panel.tsx`。
3. **质量保证**：通过 `tsc -b` 与 `npm run build` 确保零类型错误与构建安全。
