import type { Part } from './types'

export type RequestAgentInput = {
  url?: string
  baseUrl?: string
  agentId?: string
  taskId: string
  message: {
    role: 'user' | 'system'
    parts: Part[]
  }
  matchId?: string
  matchToken: string
  onThinking?: (delta: string) => void
  timeoutMs?: number
}

export async function requestAgentDecisionToy<T = Record<string, unknown>>(input: RequestAgentInput): Promise<T> {
  const { taskId, message, matchId, matchToken, onThinking, timeoutMs = 60_000 } = input
  const url = resolveAgentStreamUrl(input)
  const abort = new AbortController()
  const timer = timeoutMs > 0 ? setTimeout(() => abort.abort(), timeoutMs) : null

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(matchId ? { 'X-Match-Id': matchId } : {}),
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

function resolveAgentStreamUrl(input: RequestAgentInput): string {
  if (input.url) return input.url
  if (!input.baseUrl || !input.agentId) {
    throw new Error('requestAgentDecisionToy requires either url or baseUrl + agentId')
  }
  return `${input.baseUrl.replace(/\/$/, '')}/api/agents/${input.agentId}/message/stream`
}

function consumeSseBlock(
  block: string,
  onPayload: (payload: { kind: string; artifact?: { parts?: Part[] } }) => void,
) {
  const dataLine = block.split('\n').find((line) => line.startsWith('data: '))
  if (!dataLine) return
  onPayload(JSON.parse(dataLine.slice(6)) as { kind: string; artifact?: { parts?: Part[] } })
}
