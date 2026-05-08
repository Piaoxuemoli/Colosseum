import { generateText } from 'ai'
import { z } from 'zod'
import { findProvider } from '@/lib/llm/catalog'
import { createModel } from '@/lib/llm/provider-factory'
import { log } from '@/lib/telemetry/logger'

/**
 * Profile connectivity probe.
 *
 * Accepts `{ providerId, baseUrl, model, apiKey }` and attempts one very
 * short `generateText` call (1 token of ceiling) against the target. The
 * API key **is not persisted** — we only hold it in memory for the
 * duration of this request.
 *
 * Returns either `{ ok: true, latencyMs, sample }` or `{ ok: false, error }`.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  providerId: z.string().min(1).max(64),
  baseUrl: z.string().url(),
  model: z.string().min(1).max(128),
  apiKey: z.string().min(1).max(512),
})

// Cap the whole probe so a slow / hung endpoint can't tie up the function.
const PROBE_TIMEOUT_MS = 15_000

export async function POST(req: Request): Promise<Response> {
  const json = await req.json().catch(() => null)
  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: 'invalid body', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  // Look up the declared provider to pick the SDK kind; fall back to
  // openai-compatible for unknown ids (the catalog `custom` row does this).
  const catalogEntry = findProvider(parsed.data.providerId)
  const kind = catalogEntry?.kind ?? 'openai-compatible'

  let model
  try {
    model = createModel({
      kind,
      providerId: parsed.data.providerId,
      baseUrl: parsed.data.baseUrl,
      model: parsed.data.model,
      apiKey: parsed.data.apiKey,
    })
  } catch (err) {
    return Response.json(
      { ok: false, error: `createModel failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 400 },
    )
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)

  const started = Date.now()
  try {
    const result = await generateText({
      model,
      // 最小 payload:一句中性的 ping。兼容 chat.completions 和 responses。
      prompt: 'Reply with the single word: ok',
      // 部分 provider 不接受 maxTokens<=1,给 8 较稳。
      maxOutputTokens: 8,
      abortSignal: controller.signal,
    })
    const latencyMs = Date.now() - started
    clearTimeout(timer)
    // Redact sample if absurdly long (some providers are chatty).
    const sample = (result.text ?? '').trim().slice(0, 80)
    return Response.json({ ok: true, latencyMs, sample })
  } catch (err) {
    clearTimeout(timer)
    const message = err instanceof Error ? err.message : String(err)
    // Don't leak the apiKey if a provider echoed it in an error message.
    const safe = message.replaceAll(parsed.data.apiKey, '<redacted>')
    log.warn('profile-test failed', {
      providerId: parsed.data.providerId,
      baseUrl: parsed.data.baseUrl,
      model: parsed.data.model,
      // apiKey intentionally omitted.
      error: safe.slice(0, 500),
    })
    return Response.json({ ok: false, error: safe.slice(0, 300) }, { status: 200 })
  }
}
