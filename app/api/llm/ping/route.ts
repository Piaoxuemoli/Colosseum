import { streamText } from 'ai'
import { z } from 'zod'
import { loadEnv } from '@/lib/env'
import { createModel } from '@/lib/llm/provider-factory'
import { log } from '@/lib/telemetry/logger'

export const runtime = 'nodejs'

const bodySchema = z.object({
  prompt: z.string().min(1).max(2000),
})

export async function POST(req: Request): Promise<Response> {
  const env = loadEnv()
  if (!env.TEST_LLM_BASE_URL || !env.TEST_LLM_API_KEY || !env.TEST_LLM_MODEL) {
    return Response.json({ error: 'TEST_LLM_* env not configured' }, { status: 503 })
  }

  const json = await req.json().catch(() => null)
  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) {
    return Response.json({ error: 'invalid body', details: parsed.error.flatten() }, { status: 400 })
  }

  const model = createModel({
    kind: 'openai-compatible',
    providerId: 'test-llm',
    baseUrl: env.TEST_LLM_BASE_URL,
    model: env.TEST_LLM_MODEL,
    apiKey: env.TEST_LLM_API_KEY,
  })

  const result = streamText({
    model,
    messages: [{ role: 'user', content: parsed.data.prompt }],
  })

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        let fullText = ''
        for await (const delta of result.textStream) {
          fullText += delta
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ kind: 'delta', text: delta })}\n\n`))
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ kind: 'done', fullText })}\n\n`))
      } catch (err) {
        log.error('llm ping stream failed', { err: String(err) })
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ kind: 'error', message: String(err) })}\n\n`))
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
