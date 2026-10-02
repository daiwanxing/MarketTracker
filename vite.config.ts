import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'

function apiQuotesDevPlugin(): Plugin {
  return {
    name: 'api-quotes-dev-plugin',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url && (req.url === '/api/quotes' || req.url.startsWith('/api/quotes?'))) {
          try {
            const mod = await server.ssrLoadModule('/api/quotes.ts')
            const vercelRes = res as unknown as {
              status: (code: number) => typeof vercelRes
              json: (data: unknown) => typeof vercelRes
              statusCode: number
              setHeader: (k: string, v: string) => void
              end: (chunk?: unknown) => void
            }
            if (!vercelRes.status) {
              vercelRes.status = function (code: number) {
                this.statusCode = code
                return this
              }
            }
            if (!vercelRes.json) {
              vercelRes.json = function (data: unknown) {
                this.setHeader('Content-Type', 'application/json; charset=utf-8')
                this.end(JSON.stringify(data))
                return this
              }
            }
            await mod.default(req, vercelRes)
            return
          } catch (err) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({ error: String(err) }))
            return
          }
        }
        next()
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const base = env.VITE_BASE || '/'
  return {
    base,
    plugins: [react(), apiQuotesDevPlugin()],
  }
})
