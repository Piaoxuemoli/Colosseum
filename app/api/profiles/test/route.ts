import { z } from 'zod'
import { log } from '@/lib/telemetry/logger'

/**
 * Profile connectivity probe.
 *
 * Sends one minimal `POST {baseUrl}/chat/completions` with OpenAI-compatible
 * body and reports the result. We deliberately do NOT go through the AI SDK
 * here because:
 *   1. The probe is a trivial round-trip; the SDK's model/parse machinery is
 *      unnecessary complexity.
 *   2. `ai@5` + `@ai-sdk/openai-compatible@2.x` currently mismatch on
 *      LanguageModelV2/V3 — see `docs/ai/session-state.md` "SDK / Plan Drift
 *      Notes". The SDK throws at runtime even though TS compiles.
 *
 * The API key is only held in memory during the request and is **never**
 * persisted nor written to logs (server logs redact it).
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

  const { baseUrl, model, apiKey } = parsed.data
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)

  const started = Date.now()
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        // Neutral single-turn ping. `max_tokens` small to keep the probe
        // cheap across providers.
        messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
        max_tokens: 8,
        temperature: 0,
        stream: false,
      }),
      signal: controller.signal,
    })
    clearTimeout(timer)
    const latencyMs = Date.now() - started

    if (!res.ok) {
      // Try to parse the provider's JSON error; fall back to raw text.
      const errText = await res.text().catch(() => '')
      const safe = errText.replaceAll(apiKey, '<redacted>').slice(0, 300)
      return Response.json(
        { ok: false, error: `HTTP ${res.status}: ${safe || res.statusText}` },
        { status: 200 },
      )
    }

    const data = (await res.json().catch(() => null)) as
      | { choices?: Array<{ message?: { content?: string } }> }
      | null
    const sample = (data?.choices?.[0]?.message?.content ?? '').trim().slice(0, 80)

    return Response.json({ ok: true, latencyMs, sample })
  } catch (err) {
    clearTimeout(timer)
    const message = err instanceof Error ? err.message : String(err)
    // Belt and braces: strip the apiKey from any error message too.
    const safe = message.replaceAll(apiKey, '<redacted>').slice(0, 300)
    log.warn('profile-test failed', {
      providerId: parsed.data.providerId,
      baseUrl,
      model,
      // apiKey intentionally omitted.
      error: safe,
    })
    return Response.json({ ok: false, error: safe }, { status: 200 })
  }
}
