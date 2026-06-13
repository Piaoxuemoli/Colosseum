/**
 * Low-level A2A v0.3 SSE frame writer.
 *
 * Frames emitted:
 * - status-update: { kind: 'status-update', taskId, status: { state, timestamp, ...extra } }
 * - artifact-update: { kind: 'artifact-update', taskId, artifact: { parts: [...] }, delta?: boolean }
 *
 * This is the preferred helper for new JSON-RPC routes. The older
 * `createA2AStreamResponse` (server-helpers.ts) remains in use for toy agents
 * and existing tests and continues to emit equivalent frames.
 */
export type A2ATaskState = 'submitted' | 'working' | 'completed' | 'failed'

export class A2ASseWriter {
  private encoder = new TextEncoder()
  constructor(
    private controller: ReadableStreamDefaultController<Uint8Array>,
    private taskId: string,
  ) {}

  status(state: A2ATaskState, extra?: Record<string, unknown>) {
    this.write({
      kind: 'status-update',
      taskId: this.taskId,
      status: { state, timestamp: new Date().toISOString(), ...extra },
    })
  }

  artifactText(text: string, delta = true) {
    this.write({
      kind: 'artifact-update',
      taskId: this.taskId,
      artifact: { parts: [{ kind: 'text', text }] },
      delta,
    })
  }

  artifactData(data: unknown) {
    this.write({
      kind: 'artifact-update',
      taskId: this.taskId,
      artifact: { parts: [{ kind: 'data', data }] },
      delta: false,
    })
  }

  close() {
    this.controller.close()
  }

  private write(payload: unknown) {
    this.controller.enqueue(this.encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
  }
}
