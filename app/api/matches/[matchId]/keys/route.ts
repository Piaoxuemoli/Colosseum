import { z } from 'zod'
import { putApiKey } from '@/lib/agent/key-cache'

export const runtime = 'nodejs'

const bodySchema = z.object({
  profileId: z.string().min(1),
  apiKey: z.string().min(1),
})

export async function POST(req: Request, context: { params: Promise<{ matchId: string }> }): Promise<Response> {
  const { matchId } = await context.params
  const json = await req.json().catch(() => null)
  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) {
    return Response.json({ error: 'invalid body', details: parsed.error.flatten() }, { status: 400 })
  }

  await putApiKey(matchId, parsed.data.profileId, parsed.data.apiKey)
  return new Response(null, { status: 204 })
}
