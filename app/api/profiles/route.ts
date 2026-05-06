import { z } from 'zod'
import { createProfile, listProfiles } from '@/lib/db/queries/profiles'
import { log } from '@/lib/telemetry/logger'

export const runtime = 'nodejs'

const createSchema = z.object({
  displayName: z.string().min(1).max(80),
  providerId: z.string().min(1),
  baseUrl: z.string().url(),
  model: z.string().min(1),
  temperature: z.number().int().min(0).max(200).optional(),
  maxTokens: z.number().int().positive().nullable().optional(),
  contextWindowTokens: z.number().int().positive().nullable().optional(),
})

export async function GET(): Promise<Response> {
  const profiles = await listProfiles()
  return Response.json({ profiles })
}

export async function POST(req: Request): Promise<Response> {
  const json = await req.json().catch(() => null)
  const parsed = createSchema.safeParse(json)
  if (!parsed.success) {
    return Response.json({ error: 'validation', details: parsed.error.flatten() }, { status: 400 })
  }

  const row = await createProfile(parsed.data)
  log.info('profile created', { profileId: row.id })
  return Response.json(row, { status: 201 })
}
