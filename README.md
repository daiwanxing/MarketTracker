# MarketTracker

个人专业级大宗商品与科技半导体行情决策看板。Vite + React + TypeScript SPA，将原油、黄金、厄尔尼诺和科技半导体（AI算力与芯片制造）统一在一个控制台中呈现。

线上地址：https://market-tracker-khaki.vercel.app

板块路由：

- `/oil` — 原油（首页默认跳转）
- `/gold` — 黄金
- `/enso` — 气象气候（ENSO）
- `/semi` — 科创 50 & SOX & KOSPI（科技产业核心指数）
- `/equip` — 半导体设备材料（订单、交期、耗材披露跟踪）
- `/optics` — 光模块（速率结构与相对费半）
- `/robot` — 人形机器人（六维产业观察盘、生产场景渗透率与上游核心硬件跟踪）

## 技术架构

- **前端**：Vite + React 19 + TypeScript + React Router + ECharts
- **部署平台**：Vercel Serverless / Edge Platform（全球 CDN 边缘加速）
- **实时行情引擎**：`/api/quotes`（Vercel Serverless Function 并发拉取美股、亚太与贵金属行情，边缘缓存 SWR 15s，前端每 20s 无感刷新）
- **数据契约层**：`src/data/*.json` 存储深度研判、多因子归因矩阵与历史时间轴
- **自动化采集流水线**：GitHub Actions（每小时定时与报价变动自动更新底包数据，推送 `main` 自动触发 Vercel 部署）

## 本地开发

```bash
pnpm install
pnpm run dev
```

开发服务器：http://localhost:5173/oil

```bash
pnpm run build    # tsc -b && vite build，产物在 dist/
pnpm run preview
```

## 平台部署 (Vercel)

本项目原生配置了 `vercel.json`，支持 SPA 客户端路由与 `/api/quotes` 边缘函数：

1. 代码推送到 `main` 分支时，Vercel 自动执行 `pnpm run build` 并全球即时生效。
2. 前端通过 `useLiveQuotes()` 钩子以 20 秒为频次轮询 `/api/quotes`，实现盘中秒级准实时行情连线；在离开标签页时自动挂起以节约资源。

## 目录结构

```
├── api/
│   └── quotes.ts           # Vercel Serverless 实时行情接口
├── vercel.json             # Vercel SPA 路由与边缘函数规则
├── vite.config.ts          # Vite 构建配置
├── src/
│   ├── main.tsx            # 应用入口
│   ├── App.tsx             # 路由分发与 LiveQuotesProvider
│   ├── components/         # 各板块可视化组件
│   ├── context/            # 全局实时连线状态总线
│   ├── hooks/              # useLiveQuotes、useReveal 等
│   ├── utils/              # 彭博终端市场时钟状态机 (marketClock.ts)
│   ├── data/               # 纯静态基准数据与研判契约 (JSON)
│   └── styles/theme.css    # 统一设计规范与 Design Tokens
├── scripts/                # Python 数据采集与大模型研判流水线
└── .github/workflows/      # 数据自动化定时刷新流水线
```
