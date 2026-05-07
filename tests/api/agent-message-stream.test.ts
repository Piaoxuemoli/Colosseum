import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('POST /api/agents/:id/message/stream', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'test')
    process.env.BASE_URL = 'http://localhost:3000'
    process.env.DB_DRIVER = 'sqlite'
    process.env.SQLITE_PATH = './tests/tmp-test.db'
    process.env.REDIS_URL = 'redis://localhost:6379'
  })

  async function callAgent(agentId: string, body: unknown): Promise<Response> {
    const { POST } = await import('@/app/api/agents/[agentId]/message/stream/route')
    const req = new Request(`http://localhost/api/agents/${agentId}/message/stream`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Match-Token': 'toy-token',
      },
      body: JSON.stringify(body),
    })
    return POST(req, { params: Promise.resolve({ agentId }) })
  }

  it('toy-poker streams a fold decision', async () => {
    const res = await callAgent('toy-poker', {
      message: { messageId: 'm1', taskId: 't1', role: 'user', parts: [{ kind: 'data', data: {} }] },
    })

    expect(res.status).toBe(200)
    const raw = await readStream(res)
    expect(raw).toContain('"action":"fold"')
    expect(raw).toContain('"state":"completed"')
  })

  it('returns 404 for unknown agent', async () => {
    const res = await callAgent('unknown-xxx', {
      message: { messageId: 'm', taskId: 't', role: 'user', parts: [] },
    })

    expect(res.status).toBe(404)
  })

  it('returns 400 when body invalid', async () => {
    const { POST } = await import('@/app/api/agents/[agentId]/message/stream/route')
    const req = new Request('http://localhost/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    })
    const res = await POST(req, { params: Promise.resolve({ agentId: 'toy-poker' }) })

    expect(res.status).toBe(400)
  })

  it('accepts JSON-RPC envelope and streams toy-poker fold', async () => {
    const { POST } = await import('@/app/api/agents/[agentId]/message/stream/route')
    const rpcBody = {
      jsonrpc: '2.0',
      id: 42,
      method: 'message/stream',
      params: {
        message: { messageId: 'm1', taskId: 't-rpc', role: 'user', parts: [{ kind: 'data', data: {} }] },
      },
    }
    const req = new Request('http://localhost/api/agents/toy-poker/message/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Match-Token': 'toy-token' },
      body: JSON.stringify(rpcBody),
    })
    const res = await POST(req, { params: Promise.resolve({ agentId: 'toy-poker' }) })

    expect(res.status).toBe(200)
    const raw = await readStream(res)
    expect(raw).toContain('"kind":"status-update"')
    expect(raw).toContain('"kind":"artifact-update"')
    expect(raw).toContain('"action":"fold"')
  })

  it('JSON-RPC with unknown method returns -32601', async () => {
    const { POST } = await import('@/app/api/agents/[agentId]/message/stream/route')
    const rpcBody = {
      jsonrpc: '2.0',
      id: 99,
      method: 'wrong/method',
      params: { message: { messageId: 'm', taskId: 't', role: 'user', parts: [] } },
    }
    const req = new Request('http://localhost/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(rpcBody),
    })
    const res = await POST(req, { params: Promise.resolve({ agentId: 'toy-poker' }) })

    expect(res.status).toBe(404)
    const body = (await res.json()) as { jsonrpc: string; id: number; error: { code: number } }
    expect(body.jsonrpc).toBe('2.0')
    expect(body.id).toBe(99)
    expect(body.error.code).toBe(-32601)
  })
})

async function readStream(res: Response): Promise<string> {
  const reader = res.body?.getReader()
  if (!reader) throw new Error('response has no body')
  const decoder = new TextDecoder()
  let raw = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    raw += decoder.decode(value)
  }
  return raw
}
