import { copyFileSync } from 'node:fs'
import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'

/** GitHub Pages project site: https://daiwanxing.github.io/MarketTracker/ */
const PAGES_BASE = '/MarketTracker/'

/**
 * GitHub Pages has no SPA rewrite. Copying index.html to 404.html lets
 * deep links such as /MarketTracker/oil load the app and keep the URL.
 */
function spaFallback404(): Plugin {
  let outDir = path.resolve('dist')
  return {
    name: 'spa-fallback-404',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.build.outDir)
    },
    closeBundle() {
      copyFileSync(path.join(outDir, 'index.html'), path.join(outDir, '404.html'))
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // Production (build and preview) uses the project Pages base.
  // `npm run dev` stays at `/`. Override with VITE_BASE, including the
  // leading and trailing slash (for example VITE_BASE=/MarketTracker/).
  const base = env.VITE_BASE || (mode === 'production' ? PAGES_BASE : '/')
  return {
    base,
    plugins: [react(), spaFallback404()],
  }
})
