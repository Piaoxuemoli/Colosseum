/**
 * LLM Client - OpenAI-compatible API wrapper
 * Calls any OpenAI-compatible endpoint (OpenAI, Anthropic via proxy, Ollama, vLLM, etc.)
 * All requests are routed through /api/proxy to bypass browser CORS restrictions.
 */

/**
 * Send a fetch request through the local CORS proxy.
 * The proxy forwards headers + body to the target URL and streams the response back.
 */
async function proxyFetch(
  targetUrl: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
): Promise<Response> {
  return fetch('/api/proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      targetUrl,
      headers: init.headers,
      body: init.body,
    }),
    signal: init.signal,
  })
}

export interface APIProfile {
  id: string
  name: string
  baseURL: string        // e.g. "https://api.openai.com/v1"
  apiKey: string         // API key (can be empty for local models)
  model: string          // e.g. "gpt-4o", "claude-sonnet-4-20250514"
  maxTokens?: number     // default 1024
  temperature?: number   // default 0.7
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface LLMResponse {
  content: string
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

/**
 * Call an OpenAI-compatible Chat Completions API.
 * Includes timeout control (AbortController) and 1 retry on failure.
 * @param externalSignal - optional external AbortSignal for global timeout control
 */
export async function callLLM(
  profile: APIProfile,
  messages: ChatMessage[],
  timeoutMs: number = 30000,
  externalSignal?: AbortSignal,
): Promise<string> {
  const maxRetries = 1
  let lastError: Error | null = null

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await callLLMOnce(profile, messages, timeoutMs, externalSignal)
      return result
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      // Only retry on non-abort errors
      if (lastError.name === 'AbortError' || lastError.message.includes('timeout')) {
        throw lastError
      }
      if (attempt < maxRetries) {
        // Brief delay before retry
        await new Promise(resolve => setTimeout(resolve, 500))
      }
    }
  }

  throw lastError || new Error('LLM call failed after retries')
}

/**
 * Normalize and build the full chat completions URL from a baseURL.
 * Handles common user input mistakes:
 * - Trailing slashes
 * - Already includes /chat/completions
 * - Missing /v1 path
 * - Missing protocol
 */
function buildChatURL(rawBaseURL: string): string {
  let url = rawBaseURL.trim()

  // Add protocol if missing
  if (!/^https?:\/\//i.test(url)) {
    url = 'https://' + url
  }

  // Remove trailing slashes
  url = url.replace(/\/+$/, '')

  // If user already included /chat/completions, use as-is
  if (url.endsWith('/chat/completions')) {
    return url
  }

  // If user included /v1/chat but not /completions (unlikely but handle it)
  if (url.endsWith('/chat')) {
    return url + '/completions'
  }

  return url + '/chat/completions'
}

/**
 * Combine an external signal with a local timeout signal.
 * Returns a signal that aborts when either fires.
 */
function combinedSignal(timeoutMs: number, externalSignal?: AbortSignal): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController()
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  // Set up local timeout (0 = no timeout)
  if (timeoutMs > 0) {
    timeoutId = setTimeout(() => controller.abort('LLM request timeout'), timeoutMs)
  }

  // Relay external abort
  const onExternalAbort = () => controller.abort('LLM total timeout (external)')
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort('LLM total timeout (external)')
    } else {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true })
    }
  }

  const cleanup = () => {
    if (timeoutId) clearTimeout(timeoutId)
    externalSignal?.removeEventListener('abort', onExternalAbort)
  }

  return { signal: controller.signal, cleanup }
}

async function callLLMOnce(
  profile: APIProfile,
  messages: ChatMessage[],
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<string> {
  const { signal, cleanup } = combinedSignal(timeoutMs, externalSignal)

  try {
    const url = buildChatURL(profile.baseURL)

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (profile.apiKey) {
      headers['Authorization'] = `Bearer ${profile.apiKey}`
    }

    const body: Record<string, unknown> = {
      model: profile.model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    }
    // Only send max_tokens if explicitly set; otherwise let the model use its default
    if (profile.maxTokens && profile.maxTokens > 0) {
      body.max_tokens = profile.maxTokens
    }
    if (profile.temperature != null && profile.temperature >= 0) {
      body.temperature = profile.temperature
    }

    const response = await proxyFetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`LLM API error ${response.status}: ${text.slice(0, 200)}`)
    }

    const data = await response.json()

    // OpenAI-compatible response format
    const content = data.choices?.[0]?.message?.content
    if (typeof content !== 'string') {
      throw new Error('Invalid LLM response: no content in choices[0].message.content')
    }

    return content
  } finally {
    cleanup()
  }
}

/**
 * Test connection to an API profile by sending a simple request.
 */
export async function testConnection(profile: APIProfile): Promise<{ ok: boolean; error?: string }> {
  try {
    const result = await callLLM(
      profile,
      [{ role: 'user', content: 'Say "ok" in one word.' }],
      10000,
    )
    return { ok: result.length > 0 }
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err)

    // Provide user-friendly error messages
    let error = raw
    if (raw === 'Failed to fetch' || raw.includes('Failed to fetch')) {
      const builtURL = buildChatURL(profile.baseURL)
      error = `无法连接到 ${builtURL}。请检查: 1) Base URL 是否正确 2) 网络/代理是否通畅 3) API 服务是否启动 4) 是否存在 CORS 跨域限制`
    } else if (raw.includes('timeout')) {
      error = '连接超时(10s)，请检查网络或 API 服务是否响应'
    } else if (raw.includes('401')) {
      error = 'API Key 无效或已过期'
    } else if (raw.includes('403')) {
      error = 'API Key 无权限访问该模型'
    } else if (raw.includes('404')) {
      error = `接口不存在，请检查 Base URL 是否正确（当前拼接为: ${buildChatURL(profile.baseURL)}）`
    } else if (raw.includes('429')) {
      error = 'API 请求频率超限，请稍后再试'
    }

    return { ok: false, error }
  }
}

/**
 * Call an OpenAI-compatible Chat Completions API with streaming.
 * Reads SSE chunks and calls onChunk with each delta and the accumulated text.
 * On timeout or abort, propagates the error (does NOT fallback to non-streaming).
 * On other errors (e.g. streaming not supported), falls back to non-streaming callLLM.
 * @param externalSignal - optional external AbortSignal for global timeout control
 */
export async function callLLMStreaming(
  profile: APIProfile,
  messages: ChatMessage[],
  onChunk: (delta: string, fullText: string) => void,
  timeoutMs: number = 30000,
  externalSignal?: AbortSignal,
): Promise<string> {
  const { signal, cleanup } = combinedSignal(timeoutMs, externalSignal)

  try {
    const url = buildChatURL(profile.baseURL)

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (profile.apiKey) {
      headers['Authorization'] = `Bearer ${profile.apiKey}`
    }

    const body: Record<string, unknown> = {
      model: profile.model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      stream: true,
    }
    if (profile.maxTokens && profile.maxTokens > 0) {
      body.max_tokens = profile.maxTokens
    }
    if (profile.temperature != null && profile.temperature >= 0) {
      body.temperature = profile.temperature
    }

    const response = await proxyFetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`LLM API error ${response.status}: ${text.slice(0, 200)}`)
    }

    if (!response.body) {
      throw new Error('No response body for streaming')
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let fullText = ''
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      // Process complete SSE lines
      const lines = buffer.split('\n')
      buffer = lines.pop() || '' // Keep incomplete line in buffer

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed === 'data: [DONE]') continue
        if (!trimmed.startsWith('data: ')) continue

        try {
          const json = JSON.parse(trimmed.slice(6))
          const delta = json.choices?.[0]?.delta?.content
          if (typeof delta === 'string' && delta.length > 0) {
            fullText += delta
            onChunk(delta, fullText)
          }
        } catch {
          // Skip unparseable lines
        }
      }
    }

    return fullText
  } catch (err) {
    cleanup()
    // If aborted (timeout / external abort), propagate — do NOT fallback
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('LLM streaming timeout')
    }
    if (err instanceof Error && err.message.includes('timeout')) {
      throw err
    }
    // Fall back to non-streaming only for non-timeout errors (e.g. streaming not supported)
    console.warn('Streaming failed, falling back to non-streaming:', err)
    return callLLM(profile, messages, timeoutMs, externalSignal)
  } finally {
    cleanup()
  }
}
