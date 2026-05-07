import { describe, expect, it } from 'vitest'
import { A2ASseWriter } from '@/lib/a2a-core/sse-writer'

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  const chunks: string[] = []
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    chunks.push(decoder.decode(value))
  }
  return chunks.join('')
}

describe('A2ASseWriter', () => {
  it('writes status + artifact frames in order', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(ctrl) {
        const w = new A2ASseWriter(ctrl, 'task1')
        w.status('submitted')
        w.status('working')
        w.artifactText('hello', true)
        w.artifactData({ action: { type: 'fold' } })
        w.status('completed')
        w.close()
      },
    })
    const joined = await readAll(stream)

    expect(joined).toContain('"kind":"status-update"')
    expect(joined).toContain('"state":"submitted"')
    expect(joined).toContain('"state":"working"')
    expect(joined).toContain('"kind":"artifact-update"')
    expect(joined).toContain('"text":"hello"')
    expect(joined).toContain('"type":"fold"')
    expect(joined).toContain('"state":"completed"')
    expect(joined.indexOf('submitted')).toBeLessThan(joined.indexOf('completed'))
  })

  it('forwards extra fields on status frames', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(ctrl) {
        const w = new A2ASseWriter(ctrl, 'task-x')
        w.status('failed', { error: { code: -32000, message: 'timeout' } })
        w.close()
      },
    })
    const joined = await readAll(stream)
    expect(joined).toContain('"error":{"code":-32000,"message":"timeout"}')
  })

  it('artifact data frames have delta:false', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(ctrl) {
        const w = new A2ASseWriter(ctrl, 't')
        w.artifactData({ x: 1 })
        w.close()
      },
    })
    const joined = await readAll(stream)
    expect(joined).toContain('"delta":false')
  })
})
