# MarketTracker

个人市场题材看板。Vite + React + TypeScript SPA，把原油行情、黄金行情和厄尔尼诺放在同一个站点里。

线上地址：https://daiwanxing.github.io/MarketTracker/

板块路由（都挂在项目子路径 `/MarketTracker/` 下）：

- `/oil` — 原油行情（首页默认跳转到这里）
- `/gold` — 黄金行情
- `/enso` — 厄尔尼诺
- `/semi` — 科技半导体（算力与芯片）

例如：https://daiwanxing.github.io/MarketTracker/semi

## 技术栈

Vite + React 19 + TypeScript + React Router + ECharts。

生产构建的 Vite `base` 和 React Router `basename` 都是 `/MarketTracker/`。本地 `npm run dev` 使用 `/`。需要换前缀时设置 `VITE_BASE`（带首尾斜杠），例如 `VITE_BASE=/MarketTracker/ npm run build`。

## 本地开发

```bash
npm ci
npm run dev
```

开发服务器：http://localhost:5173/oil

```bash
npm run build    # tsc -b && vite build，产物在 dist/（含 404.html，供 Pages 深链）
npm run preview
```

`node_modules/` 和 `dist/` 不入库。

## GitHub Pages

推送到 `main`，或在 Actions 里手动运行 **Deploy GitHub Pages**，会执行：

1. `npm ci`
2. `npm run build`（`VITE_BASE=/MarketTracker/`）
3. 用 `actions/upload-pages-artifact` 上传 `dist/`
4. 用 `actions/deploy-pages` 发布到 GitHub Pages

Pages 的构建来源需要是 **GitHub Actions**（不是 “Deploy from a branch”）。工作流文件：`.github/workflows/deploy-pages.yml`。

仓库目前仍是 “Deploy from a branch / main / (root)”。这个身份没有权限通过 API 改这项设置，需要在 GitHub 上点一次：

1. 打开 https://github.com/daiwanxing/MarketTracker/settings/pages
2. **Build and deployment** → **Source** 选 **GitHub Actions**
3. 保存

在改掉之前，同一次 push 会先跑旧的分支发布，再跑上面的 Actions 工作流。工作流会等分支发布结束再部署 `dist/`，避免成品被仓库根目录的源码 `index.html` 盖掉。改成 GitHub Actions 之后，这次等待会自动跳过。

深链（刷新 `/oil`、`/gold`、`/enso`）依赖构建时复制出的 `dist/404.html`。GitHub Pages 没有 SPA 重写，未知路径会返回这个文件，路由仍由 React Router 处理。

## 更新数据

原油、黄金及科技半导体的价格数字由 **Refresh market data**（`.github/workflows/refresh-market-data.yml`）每小时刷新（`0 * * * *`），也可以在 Actions 里手动运行。脚本是 `scripts/refresh_market_data.py` 与 `scripts/refresh_tech_semi_data.py`。

原油与黄金只改能对上公开行情的数字和上海时区快照时间：布伦特 `BZ=F` 写入 `metrics.main.num`，WTI / DXY / GC 写入 `metrics.main.quotes`，不往中文叙述里替换数字。COMEX 黄金 `GC=F`、美债 10 年期 `^TNX`（Yahoo Finance chart API），以及伦敦金 XAU/USD（gold-api.com，失败时用 Swissquote 买卖中间价）。新闻、时间轴、信号正文和 `metrics.main.refs` 不动。缺昨收或副序列失败时保留原值并打 WARN，不把空值写成行情。

科技半导体（`src/data/techSemiData.json`）由 `scripts/refresh_tech_semi_data.py` 与 `scripts/refresh_tech_semi_crowding.py` 刷新：
- 每小时基准与比值走势（`scripts/refresh_tech_semi_data.py`，工作流 **Refresh market data**）：`snapshot`、`benchmarks`（SOX、NDX、TSM、恒生科技、科创50、沪深300、中证芯片ETF）、`charts.normalized`（~6个月标准化收益对比）、`charts.ratios`（科创/沪深300比值、芯片/SOX比值）。
- 工作日收盘后 A 股 TMT 真实拥挤度（`scripts/refresh_tech_semi_crowding.py`，工作流 **Refresh tech semi crowding**，周一至周五 07:30 UTC / 15:30 上海时间）：`crowding`（申万一级电子+计算机+传媒+通信全成分股实测成交额占比、TMT 内部 Top 5% 成交集中度、流通口径换手热度比率、四大行业细分拆解与头部成交标的）。
- 中文叙述（`head`、`signal`、`roadmap`、`timeline`、`news`、`risks`、`footer`、方法学说明）保持不动。

ENSO 的 CPC 数值由 **Refresh ENSO numbers**（`.github/workflows/refresh-enso-data.yml`）每天 07:15 与 19:15 UTC 刷新，也可以手动运行。脚本是 `scripts/refresh_enso_data.py`。它只写 `ensoData.json` 里的 `cpc`（传统周/月 Niño3.4、ONI，以及相对周/月 Niño3.4、Rnino34、RONI，外加 `asOf` 和各自的 `sourceUrl`）。传统和相对指数不用同一个字段。期次、时间轴和观点不动；文件没有更新的完整周或月时不提交。

刷新任务用 `GITHUB_TOKEN` 把 JSON 提交到 `main`。这类 push 不会再触发 `push` 工作流，所以 **Deploy GitHub Pages** 监听 **Refresh market data**、**Refresh ENSO numbers** 与 **Refresh tech semi crowding** 完成（`workflow_run`），用更新后的数字重新构建。

叙事内容仍是手改 `src/data/oilData.json`、`goldData.json`、`ensoData.json` 或 `techSemiData.json` 里 Actions 不负责的文字，然后推到 `main`。哪些键不能改，见 `AGENTS.md`。

离线自测：

```bash
python3 scripts/refresh_market_data.py --self-test
python3 scripts/refresh_tech_semi_data.py --self-test
python3 scripts/refresh_tech_semi_crowding.py --self-test
python3 scripts/refresh_enso_data.py --self-test
```

## 目录

```
├── index.html
├── vite.config.ts          # 生产 base 默认 /MarketTracker/，可用 VITE_BASE 覆盖
├── src/
│   ├── main.tsx            # BrowserRouter basename 与 Vite base 一致
│   ├── App.tsx
│   ├── components/         # Sidebar、OilPanel、GoldPanel、EnsoPanel、TechSemiPanel
│   ├── data/
│   └── styles/theme.css
├── scripts/refresh_market_data.py
├── scripts/refresh_tech_semi_data.py
├── scripts/refresh_tech_semi_crowding.py
├── scripts/refresh_enso_data.py
├── AGENTS.md
└── .github/workflows/
    ├── deploy-pages.yml
    ├── refresh-market-data.yml
    ├── refresh-enso-data.yml
    └── refresh-tech-semi-crowding.yml
```

## 历史

这个仓库早先是 588170 ETF 的静态页，由定时任务把行情写入 `snapshots.json`。那套页面和 `track-588170` 工作流已经移除，不再往仓库提交快照。

看板曾经发布在豆包 / 妙搭静态托管上（`lark-cli apps +deploy`）。现在的发布路径是上面的 GitHub Actions → GitHub Pages。
