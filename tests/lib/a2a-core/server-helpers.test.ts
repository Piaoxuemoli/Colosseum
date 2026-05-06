import { describe, expect, it } from 'vitest'
import { createA2AStreamResponse } from '@/lib/a2a-core/server-helpers'

describe('createA2AStreamResponse', () => {
  it('emits status and artifact events in order', async () => {
    const res = createA2AStreamResponse({
      taskId: 'task_test_1',
      async *execute(emit) {
        emit.statusUpdate('working')
        emit.artifactUpdate({ parts: [{ kind: 'text', text: 'hello ' }], delta: true })
        emit.artifactUpdate({ parts: [{ kind: 'text', text: 'world' }], delta: true })
        emit.artifactUpdate({ parts: [{ kind: 'data', data: { action: 'fold' } }], delta: false })
        emit.statusUpdate('completed')
      },
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/)

    const raw = await readStream(res)
    const events = raw
      .split('\n\n')
      .map((block) => block.split('\n').find((line) => line.startsWith('data: '))?.slice(6))
      .filter((value): value is string => Boolean(value))
      .map((value) => JSON.parse(value) as { kind: string; state?: string; artifact?: { parts?: { kind: string }[] } })

    expect(events[0]).toMatchObject({ kind: 'status-update', state: 'submitted' })
    expect(events[1]).toMatchObject({ kind: 'status-update', state: 'working' })
    expect(events[2]).toMatchObject({ kind: 'artifact-update' })
    expect(events.at(-1)).toMatchObject({ kind: 'status-update', state: 'completed' })
    expect(events.some((event) => event.artifact?.parts?.[0]?.kind === 'data')).toBe(true)
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
