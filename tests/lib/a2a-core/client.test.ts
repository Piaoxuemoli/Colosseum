import { describe, expect, it, vi } from 'vitest'
import { requestAgentDecisionRpc, requestAgentDecisionToy } from '@/lib/a2a-core/client'

describe('requestAgentDecisionToy', () => {
  it('streams text via onThinking and returns data artifact', async () => {
    const sseBody = [
      `data: ${JSON.stringify({ kind: 'status-update', taskId: 't1', state: 'submitted' })}\n\n`,
      `data: ${JSON.stringify({ kind: 'status-update', taskId: 't1', state: 'working' })}\n\n`,
      `data: ${JSON.stringify({
        kind: 'artifact-update',
        taskId: 't1',
        artifact: { artifactId: 'a0', parts: [{ kind: 'text', text: 'thinking ' }] },
        delta: true,
      })}\n\n`,
      `data: ${JSON.stringify({
        kind: 'artifact-update',
        taskId: 't1',
        artifact: { artifactId: 'a0', parts: [{ kind: 'text', text: 'more...' }] },
        delta: true,
      })}\n\n`,
      `data: ${JSON.stringify({
        kind: 'artifact-update',
        taskId: 't1',
        artifact: { artifactId: 'a1', parts: [{ kind: 'data', data: { action: 'fold' } }] },
        delta: false,
      })}\n\n`,
      `data: ${JSON.stringify({ kind: 'status-update', taskId: 't1', state: 'completed' })}\n\n`,
    ].join('')

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(sseBody, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
    )
    vi.stubGlobal('fetch', mockFetch)

    const thoughts: string[] = []
    const result = await requestAgentDecisionToy({
      url: 'http://localhost/api/agents/x/message/stream',
      taskId: 't1',
      message: { role: 'user', parts: [{ kind: 'data', data: { kind: 'test' } }] },
      matchId: 'match_1',
      matchToken: 'tok',
      onThinking: (delta) => thoughts.push(delta),
    })

    expect(thoughts.join('')).toBe('thinking more...')
    expect(result).toEqual({ action: 'fold' })
    expect(mockFetch).toHaveBeenCalledOnce()
    const init = mockFetch.mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>)['X-Match-Token']).toBe('tok')
    expect((init.headers as Record<string, string>)['X-Match-Id']).toBe('match_1')
  })

  it('throws when no data artifact returned', async () => {
    const sseBody = `data: ${JSON.stringify({ kind: 'status-update', taskId: 't1', state: 'completed' })}\n\n`
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(sseBody, { status: 200, headers: { 'content-type': 'text/event-stream' } })),
    )

    await expect(
      requestAgentDecisionToy({
        url: 'http://x',
        taskId: 't',
        message: { role: 'user', parts: [] },
        matchToken: 't',
      }),
    ).rejects.toThrow(/no data artifact/i)
  })
})

describe('requestAgentDecisionRpc', () => {
  it('sends a JSON-RPC envelope and parses decision payload', async () => {
    const sseBody = [
      `data: ${JSON.stringify({ kind: 'status-update', taskId: 't2', state: 'working' })}\n\n`,
      `data: ${JSON.stringify({
        kind: 'artifact-update',
        taskId: 't2',
        artifact: { artifactId: 'a0', parts: [{ kind: 'text', text: 'think-' }] },
        delta: true,
      })}\n\n`,
      `data: ${JSON.stringify({
        kind: 'artifact-update',
        taskId: 't2',
        artifact: {
          artifactId: 'a1',
          parts: [{ kind: 'data', data: { action: { type: 'fold' }, fallback: false } }],
        },
        delta: false,
      })}\n\n`,
      `data: ${JSON.stringify({ kind: 'status-update', taskId: 't2', state: 'completed' })}\n\n`,
    ].join('')

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(sseBody, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    )
    vi.stubGlobal('fetch', mockFetch)

    const thoughts: string[] = []
    const res = await requestAgentDecisionRpc<{ type: string }>({
      url: 'http://localhost/api/agents/x/message/stream',
      taskId: 't2',
      message: { role: 'user', parts: [{ kind: 'data', data: { kind: 'poker/decide' } }] },
      matchId: 'match_1',
      matchToken: 'tok',
      onThinking: (d) => thoughts.push(d),
    })

    expect(res.action).toEqual({ type: 'fold' })
    expect(res.thinkingText).toBe('think-')
    expect(res.fallback).toBe(false)

    const init = mockFetch.mock.calls[0][1] as RequestInit
    const body = JSON.parse((init.body as string) ?? '{}') as {
      jsonrpc: string
      method: string
      params: { matchId?: string; message: { taskId: string } }
    }
    expect(body.jsonrpc).toBe('2.0')
    expect(body.method).toBe('message/stream')
    expect(body.params.matchId).toBe('match_1')
    expect(body.params.message.taskId).toBe('t2')
  })

  it('extracts fallback flag + errorKind from terminal artifact', async () => {
    const sseBody = [
      `data: ${JSON.stringify({
        kind: 'artifact-update',
        taskId: 't3',
        artifact: {
          artifactId: 'a1',
          parts: [{ kind: 'data', data: { action: { type: 'check' }, fallback: true, errorKind: 'timeout' } }],
        },
        delta: false,
      })}\n\n`,
      `data: ${JSON.stringify({ kind: 'status-update', taskId: 't3', state: 'completed' })}\n\n`,
    ].join('')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(sseBody, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
      ),
    )

    const res = await requestAgentDecisionRpc({
      url: 'http://x', taskId: 't3',
      message: { role: 'user', parts: [] }, matchToken: 't',
    })
    expect(res.fallback).toBe(true)
    expect(res.errorKind).toBe('timeout')
  })
})
