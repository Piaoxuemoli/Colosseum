import type { Part } from './types'

export type RequestAgentInput = {
  url: string
  taskId: string
  message: {
    role: 'user' | 'system'
    parts: Part[]
  }
  matchToken: string
  onThinking?: (delta: string) => void
  timeoutMs?: number
}

export async function requestAgentDecisionToy<T = Record<string, unknown>>(input: RequestAgentInput): Promise<T> {
  const { url, taskId, message, matchToken, onThinking, timeoutMs = 60_000 } = input
  const abort = new AbortController()
  const timer = timeoutMs > 0 ? setTimeout(() => abort.abort(), timeoutMs) : null

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Match-Token': matchToken,
      },
      body: JSON.stringify({
        message: {
          messageId: `msg_${taskId}`,
          taskId,
          ...message,
        },
      }),
      signal: abort.signal,
    })

    if (!res.ok || !res.body) {
      throw new Error(`agent endpoint returned ${res.status}`)
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let decision: T | null = null

    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let boundary = buffer.indexOf('\n\n')
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        consumeSseBlock(block, (payload) => {
          if (payload.kind !== 'artifact-update') return
          for (const part of payload.artifact?.parts ?? []) {
            if (part.kind === 'text') onThinking?.(part.text)
            if (part.kind === 'data' && !decision) decision = part.data as T
          }
        })
        boundary = buffer.indexOf('\n\n')
      }
    }

    if (!decision) throw new Error('no data artifact returned')
    return decision
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function consumeSseBlock(
  block: string,
  onPayload: (payload: { kind: string; artifact?: { parts?: Part[] } }) => void,
) {
  const dataLine = block.split('\n').find((line) => line.startsWith('data: '))
  if (!dataLine) return
  onPayload(JSON.parse(dataLine.slice(6)) as { kind: string; artifact?: { parts?: Part[] } })
}
