import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { request as httpRequest } from 'node:http'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'cors-proxy',
      configureServer(server) {
        server.middlewares.use('/api/proxy', (req: IncomingMessage, res: ServerResponse, next: () => void) => {
          if (req.method !== 'POST') { next(); return }

          let rawBody = ''
          req.on('data', (chunk: Buffer) => { rawBody += chunk.toString() })
          req.on('end', () => {
            let parsed: { targetUrl: string; headers?: Record<string, string>; body?: string }
            try {
              parsed = JSON.parse(rawBody)
            } catch {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Invalid JSON body' }))
              return
            }

            const { targetUrl, headers: fwdHeaders, body: fwdBody } = parsed
            if (!targetUrl) {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Missing targetUrl' }))
              return
            }

            let targetURL: URL
            try {
              targetURL = new URL(targetUrl)
            } catch {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Invalid targetUrl' }))
              return
            }

            const transport = targetURL.protocol === 'https:' ? httpsRequest : httpRequest

            // Compute Content-Length from the actual body bytes
            const bodyBuf = fwdBody ? Buffer.from(fwdBody, 'utf-8') : null
            const outHeaders: Record<string, string> = {
              ...fwdHeaders,
              'Host': targetURL.host,
            }
            if (bodyBuf) {
              outHeaders['Content-Length'] = String(bodyBuf.byteLength)
            }

            const proxyReq = transport(
              targetUrl,
              {
                method: 'POST',
                headers: outHeaders,
              },
              (proxyRes) => {
                // Copy status and headers from upstream, add CORS
                const responseHeaders: Record<string, string | string[] | undefined> = {
                  ...proxyRes.headers,
                  'Access-Control-Allow-Origin': '*',
                }
                res.writeHead(proxyRes.statusCode || 502, responseHeaders)
                proxyRes.pipe(res)
              },
            )

            proxyReq.on('error', (err) => {
              res.writeHead(502, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: `Proxy error: ${err.message}` }))
            })

            if (bodyBuf) {
              proxyReq.write(bodyBuf)
            }
            proxyReq.end()
          })
        })
      },
    },
  ],
})
