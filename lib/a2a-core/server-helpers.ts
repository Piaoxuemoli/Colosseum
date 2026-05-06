import type { A2AEmitter, A2AStreamEvent, ArtifactUpdateInput, TaskState } from './types'

export type CreateA2AStreamOptions = {
  taskId: string
  execute: (emit: A2AEmitter) => AsyncGenerator<void, void, unknown> | Promise<void> | void
}

export function createA2AStreamResponse(options: CreateA2AStreamOptions): Response {
  const { taskId, execute } = options
  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let artifactCounter = 0

      const write = (event: A2AStreamEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }

      const emit: A2AEmitter = {
        statusUpdate(state: TaskState, message?: string) {
          write({ kind: 'status-update', taskId, state, message })
        },
        artifactUpdate(input: ArtifactUpdateInput) {
          write({
            kind: 'artifact-update',
            taskId,
            artifact: {
              artifactId: input.artifactId ?? `artifact_${artifactCounter++}`,
              parts: input.parts,
            },
            delta: input.delta ?? false,
          })
        },
      }

      try {
        emit.statusUpdate('submitted')
        const result = execute(emit)
        if (result && typeof (result as AsyncGenerator<void, void, unknown>).next === 'function') {
          for await (const _item of result as AsyncGenerator<void, void, unknown>) {
            // The generator communicates by calling emit.
          }
        } else {
          await result
        }
      } catch (err) {
        emit.statusUpdate('failed', String(err))
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    },
  })
}
