# MarketTracker

个人市场题材看板。Vite + React + TypeScript SPA，把原油行情、黄金行情和厄尔尼诺放在同一个站点里。

线上地址：https://daiwanxing.github.io/MarketTracker/

板块路由（都挂在项目子路径 `/MarketTracker/` 下）：

- `/oil` — 原油行情（首页默认跳转到这里）
- `/gold` — 黄金行情
- `/enso` — 厄尔尼诺

例如：https://daiwanxing.github.io/MarketTracker/oil

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

编辑 `src/data/oilData.json`、`goldData.json` 或 `ensoData.json`，然后推到 `main`。Pages 工作流会重新构建并发布。

## 目录

```
├── index.html
├── vite.config.ts          # 生产 base 默认 /MarketTracker/，可用 VITE_BASE 覆盖
├── src/
│   ├── main.tsx            # BrowserRouter basename 与 Vite base 一致
│   ├── App.tsx
│   ├── components/         # Sidebar、OilPanel、GoldPanel、EnsoPanel
│   ├── data/
│   └── styles/theme.css
└── .github/workflows/deploy-pages.yml
```

## 历史

这个仓库早先是 588170 ETF 的静态页，由定时任务把行情写入 `snapshots.json`。那套页面和 `track-588170` 工作流已经移除，不再往仓库提交快照。

看板曾经发布在豆包 / 妙搭静态托管上（`lark-cli apps +deploy`）。现在的发布路径是上面的 GitHub Actions → GitHub Pages。
