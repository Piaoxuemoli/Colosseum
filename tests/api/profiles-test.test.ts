import { beforeAll, describe, expect, it, vi } from 'vitest'

// Mock the ai SDK generateText so the probe never hits a real endpoint.
const generateTextSpy = vi.hoisted(() => vi.fn())
vi.mock('ai', async (orig) => {
  const real = (await orig()) as object
  return {
    ...real,
    generateText: generateTextSpy,
  }
})

describe('POST /api/profiles/test', () => {
  beforeAll(() => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('BASE_URL', 'http://localhost:3000')
    vi.stubEnv('DB_DRIVER', 'sqlite')
    vi.stubEnv('SQLITE_PATH', './tests/tmp-profiles-test.db')
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379')
  })

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

  it('returns ok:true + latency + sample on success', async () => {
    generateTextSpy.mockReset()
    generateTextSpy.mockResolvedValueOnce({ text: '  ok  ' })

    const { POST } = await import('@/app/api/profiles/test/route')
    const req = new Request('http://localhost/api/profiles/test', {
      method: 'POST',
      body: JSON.stringify({
        providerId: 'openai',
        baseUrl: 'https://api.openai.com/v1',
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
  })

  it('returns ok:false on provider error and redacts the apiKey', async () => {
    generateTextSpy.mockReset()
    generateTextSpy.mockRejectedValueOnce(
      new Error('401 unauthorized for key sk-fake-leak-xxx'),
    )

    const { POST } = await import('@/app/api/profiles/test/route')
    const req = new Request('http://localhost/api/profiles/test', {
      method: 'POST',
      body: JSON.stringify({
        providerId: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        apiKey: 'sk-fake-leak-xxx',
      }),
      headers: { 'content-type': 'application/json' },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; error: string }
    expect(body.ok).toBe(false)
    // apiKey is redacted from the error message.
    expect(body.error).not.toContain('sk-fake-leak-xxx')
    expect(body.error).toContain('<redacted>')
  })

  it('falls back to openai-compatible kind for unknown providerId', async () => {
    generateTextSpy.mockReset()
    generateTextSpy.mockResolvedValueOnce({ text: 'ok' })

    const { POST } = await import('@/app/api/profiles/test/route')
    const req = new Request('http://localhost/api/profiles/test', {
      method: 'POST',
      body: JSON.stringify({
        providerId: 'some-unknown-provider',
        baseUrl: 'https://example.com/v1',
        model: 'foo',
        apiKey: 'sk-xxx',
      }),
      headers: { 'content-type': 'application/json' },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean }
    expect(body.ok).toBe(true)
  })
})
