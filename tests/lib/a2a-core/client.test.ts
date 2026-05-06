import { describe, expect, it, vi } from 'vitest'
import { requestAgentDecisionToy } from '@/lib/a2a-core/client'

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
