import { z } from 'zod'
import { agentKindSchema, gameTypeSchema } from '@/lib/core/types'
import { hasGame } from '@/lib/core/registry'
import { createAgent, listAgents } from '@/lib/db/queries/agents'
import { findProfileById } from '@/lib/db/queries/profiles'
import { ensureGamesRegistered } from '@/lib/instrument'
import { log } from '@/lib/telemetry/logger'

export const runtime = 'nodejs'

const createSchema = z
  .object({
    displayName: z.string().min(1).max(80),
    gameType: gameTypeSchema,
    kind: agentKindSchema.optional(),
    profileId: z.string().min(1),
    systemPrompt: z.string().min(1).max(4000),
    avatarEmoji: z.string().max(8).nullable().optional(),
  })
  .refine((data) => !(data.gameType === 'poker' && data.kind === 'moderator'), {
    message: 'poker does not support moderator kind',
    path: ['kind'],
  })

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const gameType = url.searchParams.get('gameType')
  const kind = url.searchParams.get('kind')
  const parsedGameType = gameType ? gameTypeSchema.safeParse(gameType) : null
  const parsedKind = kind ? agentKindSchema.safeParse(kind) : null

  const agents = await listAgents({
    gameType: parsedGameType?.success ? parsedGameType.data : undefined,
    kind: parsedKind?.success ? parsedKind.data : undefined,
  })
  return Response.json({ agents })
}

export async function POST(req: Request): Promise<Response> {
  ensureGamesRegistered()

  const json = await req.json().catch(() => null)
  const parsed = createSchema.safeParse(json)
  if (!parsed.success) {
    return Response.json({ error: 'validation', details: parsed.error.flatten() }, { status: 400 })
  }
  if (!hasGame(parsed.data.gameType)) {
    return Response.json({ error: `unsupported gameType: ${parsed.data.gameType}` }, { status: 400 })
  }

  const profile = await findProfileById(parsed.data.profileId)
  if (!profile) return Response.json({ error: 'profile not found' }, { status: 404 })

  const row = await createAgent(parsed.data)
  log.info('agent created', { agentId: row.id, gameType: row.gameType })
  return Response.json(row, { status: 201 })
}
