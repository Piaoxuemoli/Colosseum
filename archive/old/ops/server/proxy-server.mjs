/**
 * Production proxy server — zero dependencies.
 * Serves dist/ static files + proxies POST /api/proxy to bypass CORS.
 *
 * Usage:  node ops/server/proxy-server.mjs
 */

import { createServer } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { request as httpRequest } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = process.env.PORT || 3000
const __dirname = fileURLToPath(new URL('.', import.meta.url))
const DIST = join(__dirname, '..', '..', 'dist')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.webp': 'image/webp',
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => { data += chunk })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

function handleProxy(req, res) {
  readBody(req).then((raw) => {
    let parsed
    try { parsed = JSON.parse(raw) } catch {
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

    let targetURL
    try { targetURL = new URL(targetUrl) } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Invalid targetUrl' }))
      return
    }

    const transport = targetURL.protocol === 'https:' ? httpsRequest : httpRequest
    const bodyBuf = fwdBody ? Buffer.from(fwdBody, 'utf-8') : null
    const outHeaders = { ...fwdHeaders, Host: targetURL.host }
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
        const responseHeaders = { ...proxyRes.headers, 'Access-Control-Allow-Origin': '*' }
        res.writeHead(proxyRes.statusCode || 502, responseHeaders)
        proxyRes.pipe(res)
      },
    )

    proxyReq.on('error', (err) => {
      res.writeHead(502, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: `Proxy error: ${err.message}` }))
    })

    if (bodyBuf) proxyReq.write(bodyBuf)
    proxyReq.end()
  })
}

async function serveStatic(req, res) {
  let urlPath = new URL(req.url, 'http://localhost').pathname
  if (urlPath === '/') urlPath = '/index.html'

  const filePath = join(DIST, urlPath)
  if (!filePath.startsWith(DIST)) {
    res.writeHead(403)
    res.end('Forbidden')
    return
  }

  try {
    const data = await readFile(filePath)
    const ext = extname(filePath)
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' })
    res.end(data)
  } catch {
    try {
      const html = await readFile(join(DIST, 'index.html'))
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(html)
    } catch {
      res.writeHead(404)
      res.end('Not Found — did you run `npm run build`?')
    }
  }
}

const server = createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/proxy') {
    handleProxy(req, res)
  } else {
    serveStatic(req, res)
  }
})

server.listen(PORT, () => {
  console.log(`Proxy + static server running at http://localhost:${PORT}`)
})
