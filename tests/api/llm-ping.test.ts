import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('POST /api/llm/ping (mocked)', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('NODE_ENV', 'test')
    process.env.BASE_URL = 'http://localhost:3000'
    process.env.DB_DRIVER = 'sqlite'
    process.env.SQLITE_PATH = './tests/tmp-test.db'
    process.env.REDIS_URL = 'redis://localhost:6379'
    process.env.TEST_LLM_BASE_URL = 'https://fake.local'
    process.env.TEST_LLM_API_KEY = 'sk-fake'
    process.env.TEST_LLM_MODEL = 'fake-model'

    vi.doMock('@/lib/llm/provider-factory', () => ({
      createModel: () => ({ modelId: 'fake-model' }),
    }))
    vi.doMock('ai', async () => {
      const actual = (await vi.importActual('ai')) as Record<string, unknown>
      return {
        ...actual,
        streamText: () => ({
          textStream: (async function* () {
            yield 'Hello '
            yield 'world'
          })(),
        }),
      }
    })
  })

  it('returns an SSE stream with concatenated text deltas', async () => {
    const { POST } = await import('@/app/api/llm/ping/route')
    const req = new Request('http://localhost/api/llm/ping', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'Say hello' }),
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/)

    const reader = res.body?.getReader()
    expect(reader).toBeDefined()
    const decoder = new TextDecoder()
    let raw = ''
    for (;;) {
      const { done, value } = await reader!.read()
      if (done) break
      raw += decoder.decode(value)
    }

    expect(raw).toContain('Hello')
    expect(raw).toContain('world')
    expect(raw).toContain('"kind":"done"')
  })
})
