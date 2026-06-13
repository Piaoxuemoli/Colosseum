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

/**
 * A2A v0.3 JSON-RPC client.
 *
 * Wraps the message in a JSON-RPC 2.0 envelope with `method: "message/stream"`
 * and parses the SSE stream of `status-update` / `artifact-update` frames.
 * This is the preferred client for code that wants strict v0.3 compliance.
 *
 * Returns the final action payload extracted from the terminal `artifact-update`
 * frame of kind `data`.
 */
export type AgentDecisionResult<T = Record<string, unknown>> = {
  action: T
  thinkingText: string
  fallback: boolean
  errorKind?: string
}

export async function requestAgentDecisionRpc<T = Record<string, unknown>>(
  input: RequestAgentInput,
): Promise<AgentDecisionResult<T>> {
  const { taskId, message, matchId, matchToken, onThinking, timeoutMs = 60_000 } = input
  const url = resolveAgentStreamUrl(input)
  const abort = new AbortController()
  const timer = timeoutMs > 0 ? setTimeout(() => abort.abort(), timeoutMs) : null

  try {
    const rpcBody = {
      jsonrpc: '2.0' as const,
      id: Date.now(),
      method: 'message/stream',
      params: {
        ...(matchId ? { matchId } : {}),
        message: {
          messageId: `msg_${taskId}`,
          taskId,
          ...message,
        },
      },
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'text/event-stream',
        ...(matchId ? { 'X-Match-Id': matchId } : {}),
        'X-Match-Token': matchToken,
      },
      body: JSON.stringify(rpcBody),
      signal: abort.signal,
    })

    if (!res.ok || !res.body) {
      throw new Error(`agent endpoint returned ${res.status}`)
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let decision: T | null = null
    let thinkingText = ''
    let fallback = false
    let errorKind: string | undefined

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
            if (part.kind === 'text') {
              thinkingText += part.text
              onThinking?.(part.text)
            }
            if (part.kind === 'data' && !decision) {
              const data = part.data as Record<string, unknown> | undefined
              if (data && typeof data === 'object') {
                if ('fallback' in data) fallback = Boolean(data.fallback)
                if ('errorKind' in data && typeof data.errorKind === 'string') errorKind = data.errorKind
                if ('action' in data) {
                  decision = data.action as T
                }
              }
            }
          }
        })
        boundary = buffer.indexOf('\n\n')
      }
    }

    if (!decision) throw new Error('no action artifact returned')
    return { action: decision, thinkingText, fallback, errorKind }
  } finally {
    if (timer) clearTimeout(timer)
  }
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
