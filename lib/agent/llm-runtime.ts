import { streamText } from 'ai'
import type { ProviderKind } from '@/lib/llm/catalog'
import { createModel } from '@/lib/llm/provider-factory'
import { LlmError } from './llm-errors'
import { LlmStreamParser } from './llm-stream-parser'

export type LlmRuntimeProfile = {
  providerKind: ProviderKind
  providerId: string
  baseUrl: string
  apiKey: string
  model: string
}

export type LlmRuntimeAgent = {
  systemPrompt: string
}

export type LlmRuntimeInput = {
  profile: LlmRuntimeProfile
  agent: LlmRuntimeAgent
  userPrompt: string
  timeoutMs?: number
  abortSignal?: AbortSignal
  onThinkingDelta?: (text: string) => void
}

export type LlmRuntimeResult = {
  action: unknown
  thinkingText: string
  rawResponse: string
}

export async function runDecision(input: LlmRuntimeInput): Promise<LlmRuntimeResult> {
  const { profile, agent, userPrompt, timeoutMs = 60_000, abortSignal, onThinkingDelta } = input
  const parser = new LlmStreamParser()
  const timeoutController = new AbortController()
  const signal = abortSignal ? mergeSignals(abortSignal, timeoutController.signal) : timeoutController.signal
  let timeoutFired = false
  let thinkingText = ''
  let action: unknown = null
  let rawResponse = ''

  const timer = setTimeout(() => {
    timeoutFired = true
    timeoutController.abort()
  }, timeoutMs)

  try {
    const model = createModel({
      kind: profile.providerKind,
      providerId: profile.providerId,
      baseUrl: profile.baseUrl,
      model: profile.model,
      apiKey: profile.apiKey,
    })
    const result = streamText({
      model,
      system: agent.systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      abortSignal: signal,
    })

    for await (const delta of result.textStream) {
      rawResponse += delta
      for (const event of parser.feed(delta)) {
        if (event.kind === 'thinking_delta') {
          thinkingText += event.text
          onThinkingDelta?.(event.text)
        } else if (event.kind === 'action') {
          action = event.action
        }
      }
    }

    for (const event of parser.end()) {
      if (event.kind === 'thinking_delta') {
        thinkingText += event.text
        onThinkingDelta?.(event.text)
      } else if (event.kind === 'action') {
        action = event.action
      }
    }

    if (!action || isParserErrorAction(action)) {
      throw new LlmError('parse_fail', 'LLM response did not contain a valid <action> JSON object', { rawResponse, action })
    }

    return { action, thinkingText, rawResponse }
  } catch (err) {
    if (err instanceof LlmError) throw err
    if (timeoutFired) throw new LlmError('timeout', `LLM timed out after ${timeoutMs}ms`, err)
    if (abortSignal?.aborted) throw new LlmError('abort', 'LLM request aborted', err)
    throw new LlmError('api_error', err instanceof Error ? err.message : 'LLM API error', err)
  } finally {
    clearTimeout(timer)
  }
}

function isParserErrorAction(action: unknown): boolean {
  return (
    typeof action === 'object' &&
    action !== null &&
    'error' in action &&
    (action as { error?: unknown }).error === 'json_parse'
  )
}

function mergeSignals(first: AbortSignal, second: AbortSignal): AbortSignal {
  if (first.aborted) return first
  if (second.aborted) return second

  const controller = new AbortController()
  const abort = () => controller.abort()
  first.addEventListener('abort', abort, { once: true })
  second.addEventListener('abort', abort, { once: true })
  return controller.signal
}
