import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

describe('POST /api/profiles/test', () => {
  beforeAll(() => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('BASE_URL', 'http://localhost:3000')
    vi.stubEnv('DB_DRIVER', 'sqlite')
    vi.stubEnv('SQLITE_PATH', './tests/tmp-profiles-test.db')
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function mockFetchOnce(init: {
    ok: boolean
    status?: number
    statusText?: string
    json?: unknown
    text?: string
  }) {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: init.ok,
      status: init.status ?? (init.ok ? 200 : 500),
      statusText: init.statusText ?? '',
      json: async () => init.json,
      text: async () => init.text ?? JSON.stringify(init.json ?? ''),
    } as Response)
    return spy
  }

  it('returns 400 on invalid body (missing fields)', async () => {
    const { POST } = await import('@/app/api/profiles/test/route')
    const req = new Request('http://localhost/api/profiles/test', {
      method: 'POST',
      body: JSON.stringify({ providerId: 'openai' }),
      headers: { 'content-type': 'application/json' },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = (await res.json()) as { ok: boolean; error: string }
    expect(body.ok).toBe(false)
  })

  it('returns ok:true + latency + sample on 200 response', async () => {
    const spy = mockFetchOnce({
      ok: true,
      status: 200,
      json: { choices: [{ message: { content: '  ok  ' } }] },
    })

    const { POST } = await import('@/app/api/profiles/test/route')
    const req = new Request('http://localhost/api/profiles/test', {
      method: 'POST',
      body: JSON.stringify({
        providerId: 'custom',
        baseUrl: 'https://api.example.com/v1',
        model: 'gpt-4o-mini',
        apiKey: 'sk-fake-xxxxxxxxxxxxxx',
      }),
      headers: { 'content-type': 'application/json' },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; latencyMs: number; sample: string }
    expect(body.ok).toBe(true)
    expect(body.sample).toBe('ok')
    expect(typeof body.latencyMs).toBe('number')

    // Called the target chat.completions with OpenAI-compatible body.
    const [calledUrl, init] = spy.mock.calls[0] as [string, RequestInit]
    expect(calledUrl).toBe('https://api.example.com/v1/chat/completions')
    expect((init.headers as Record<string, string>).authorization).toBe(
      'Bearer sk-fake-xxxxxxxxxxxxxx',
    )
    const sentBody = JSON.parse(init.body as string) as { model: string; messages: unknown[] }
    expect(sentBody.model).toBe('gpt-4o-mini')
    expect(Array.isArray(sentBody.messages)).toBe(true)
  })

  it('returns ok:false and redacts apiKey when provider returns 401 text', async () => {
    mockFetchOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: 'invalid api key sk-fake-leak-xxx is not valid',
    })

    const { POST } = await import('@/app/api/profiles/test/route')
    const req = new Request('http://localhost/api/profiles/test', {
      method: 'POST',
      body: JSON.stringify({
        providerId: 'custom',
        baseUrl: 'https://api.example.com/v1',
        model: 'gpt-4o-mini',
        apiKey: 'sk-fake-leak-xxx',
      }),
      headers: { 'content-type': 'application/json' },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; error: string }
    expect(body.ok).toBe(false)
    expect(body.error).toContain('HTTP 401')
    // apiKey is redacted from the error echo.
    expect(body.error).not.toContain('sk-fake-leak-xxx')
    expect(body.error).toContain('<redacted>')
  })

  it('returns ok:false on network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('fetch failed'))

    const { POST } = await import('@/app/api/profiles/test/route')
    const req = new Request('http://localhost/api/profiles/test', {
      method: 'POST',
      body: JSON.stringify({
        providerId: 'custom',
        baseUrl: 'https://nonexistent.invalid/v1',
        model: 'foo',
        apiKey: 'sk-xxx',
      }),
      headers: { 'content-type': 'application/json' },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; error: string }
    expect(body.ok).toBe(false)
    expect(body.error).toContain('fetch failed')
  })

  it('strips a trailing slash from baseUrl before appending /chat/completions', async () => {
    const spy = mockFetchOnce({
      ok: true,
      status: 200,
      json: { choices: [{ message: { content: 'ok' } }] },
    })

    const { POST } = await import('@/app/api/profiles/test/route')
    const req = new Request('http://localhost/api/profiles/test', {
      method: 'POST',
      body: JSON.stringify({
        providerId: 'custom',
        baseUrl: 'https://api.example.com/v1/',
        model: 'foo',
        apiKey: 'sk-x',
      }),
      headers: { 'content-type': 'application/json' },
    })
    await POST(req)

    const [calledUrl] = spy.mock.calls[0] as [string, RequestInit]
    expect(calledUrl).toBe('https://api.example.com/v1/chat/completions')
  })
})
