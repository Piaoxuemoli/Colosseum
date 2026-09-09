import { streamText } from 'ai'
import type { ProviderKind } from '@/platform/llm/catalog'
import { createModel } from '@/platform/llm/provider-factory'
import { loadEnv } from '@/platform/env'
import { LlmError } from './llm-errors'
import { LlmStreamParser } from './llm-stream-parser'
import { extractUsage, NULL_USAGE, type LlmUsageSample } from './usage-capture'

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
  /**
   * 本次调用的 token 用量（ai@5 streamText 的 totalUsage）。流式路径下
   * openai-compatible 供应方需配置 includeUsage 才会上报；未上报时三项为
   * null——调用方仍应记一条「仅调用次数」的用量行（FR-4.8-03）。
   */
  usage: LlmUsageSample
}

export async function runDecision(input: LlmRuntimeInput): Promise<LlmRuntimeResult> {
  if (loadEnv().M4_MOCK_LLM === '1') return runMockDecision(input)

  const { profile, agent, userPrompt, timeoutMs = 180_000, abortSignal, onThinkingDelta } = input
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

    // 用量提取（FR-4.8-03）：textStream 消费完毕后 totalUsage 已可解析；
    // 供应方未上报或流异常中断时保持三项 null，绝不让用量读取失败决策。
    let usage: LlmUsageSample = { ...NULL_USAGE }
    try {
      usage = extractUsage(await result.totalUsage)
    } catch {
      // 保持 NULL_USAGE——调用次数仍可记录
    }

    return { action, thinkingText, rawResponse, usage }
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

// ---------------------------------------------------------------------------
// 旁白轻量调用（FR-4.7-01 / R3-3）：不做 <action> 解析，输出即正文文本。
// ---------------------------------------------------------------------------

export type LlmNarrationInput = {
  profile: LlmRuntimeProfile
  systemPrompt: string
  userPrompt: string
  /** 旁白是增强项：默认 30s 短超时，失败由调用方静默跳过。 */
  timeoutMs?: number
  /** 低 maxTokens 控成本（prompt 已限定 ≤80 字正文）。 */
  maxOutputTokens?: number
  /** 输出文本硬截断（双保险，防长篇跑偏）。 */
  maxTextChars?: number
}

export type LlmNarrationResult = {
  text: string
  rawResponse: string
  usage: LlmUsageSample
}

const NARRATION_DEFAULT_TIMEOUT_MS = 30_000
const NARRATION_DEFAULT_MAX_TOKENS = 256
const NARRATION_DEFAULT_MAX_CHARS = 200

export async function runNarration(input: LlmNarrationInput): Promise<LlmNarrationResult> {
  if (loadEnv().M4_MOCK_LLM === '1') return runMockNarration(input)

  const {
    profile,
    systemPrompt,
    userPrompt,
    timeoutMs = NARRATION_DEFAULT_TIMEOUT_MS,
    maxOutputTokens = NARRATION_DEFAULT_MAX_TOKENS,
    maxTextChars = NARRATION_DEFAULT_MAX_CHARS,
  } = input

  const timeoutController = new AbortController()
  let timeoutFired = false
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
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      abortSignal: timeoutController.signal,
      maxOutputTokens,
    })

    let rawResponse = ''
    for await (const delta of result.textStream) {
      rawResponse += delta
    }

    const text = rawResponse.trim().slice(0, maxTextChars)
    if (text.length === 0) {
      throw new LlmError('parse_fail', 'LLM returned empty narration text', { rawResponse })
    }

    let usage: LlmUsageSample = { ...NULL_USAGE }
    try {
      usage = extractUsage(await result.totalUsage)
    } catch {
      // 保持 NULL_USAGE——调用次数仍可记录
    }

    return { text, rawResponse, usage }
  } catch (err) {
    if (err instanceof LlmError) throw err
    if (timeoutFired) throw new LlmError('timeout', `LLM narration timed out after ${timeoutMs}ms`, err)
    throw new LlmError('api_error', err instanceof Error ? err.message : 'LLM API error', err)
  } finally {
    clearTimeout(timer)
  }
}

/** Mock 模式：从 prompt 的公开事实行取材，保证 mock 局也能全链路演练旁白。 */
async function runMockNarration(input: LlmNarrationInput): Promise<LlmNarrationResult> {
  const factLines = input.userPrompt
    .split('\n')
    .filter((line) => line.startsWith('- '))
    .slice(0, 2)
    .map((line) => line.slice(2))
  const text = `【模拟旁白】${factLines.join('；') || '对局照常推进。'}`.slice(0, input.maxTextChars ?? NARRATION_DEFAULT_MAX_CHARS)
  await new Promise((resolve) => setTimeout(resolve, 0))
  return { text, rawResponse: text, usage: { ...NULL_USAGE } }
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

async function runMockDecision(input: LlmRuntimeInput): Promise<LlmRuntimeResult> {
  const action = mockActionFromPrompt(input.userPrompt)
  const thinkingText = `M4 mock LLM selects ${action.type}.`
  input.onThinkingDelta?.(thinkingText)
  await new Promise((resolve) => setTimeout(resolve, 0))
  return {
    action,
    thinkingText,
    rawResponse: `<thinking>${thinkingText}</thinking><action>${JSON.stringify(action)}</action>`,
    // Mock 未发生真实 LLM 调用，无用量；调用方在 mock 模式下不应记用量行。
    usage: { ...NULL_USAGE },
  }
}

function mockActionFromPrompt(prompt: string): Record<string, unknown> {
  if (prompt.includes('- fold')) return { type: 'fold' }
  if (prompt.includes('- check')) return { type: 'check' }
  if (prompt.includes('- call')) return { type: 'call' }
  return { type: 'check' }
}
