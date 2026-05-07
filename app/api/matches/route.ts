import { desc } from 'drizzle-orm'
import { z } from 'zod'
import { gameTypeSchema } from '@/lib/core/types'
import { db } from '@/lib/db/client'
import { matches } from '@/lib/db/schema.sqlite'
import { loadEnv } from '@/lib/env'
import { ensureGamesRegistered } from '@/lib/instrument'
import { createAndStartMatch } from '@/lib/orchestrator/match-lifecycle'
import { MatchCreateValidationError } from '@/lib/orchestrator/match-lifecycle-validation'
import { log } from '@/lib/telemetry/logger'

export const runtime = 'nodejs'

const createSchema = z.object({
  gameType: gameTypeSchema,
  agentIds: z.array(z.string()).min(2).max(10),
  moderatorAgentId: z.string().nullable().optional(),
  config: z
    .object({
      agentTimeoutMs: z.number().int().nonnegative().optional(),
      minActionIntervalMs: z.number().int().nonnegative().optional(),
      tickConcurrencyLockMs: z.number().int().positive().optional(),
      maxConsecutiveErrors: z.number().int().positive().optional(),
    })
    .optional(),
  engineConfig: z.record(z.string(), z.unknown()).optional(),
  keyring: z.record(z.string(), z.string()).optional(),
})

export async function GET(): Promise<Response> {
  const rows = await db.select().from(matches).orderBy(desc(matches.startedAt)).limit(50)
  return Response.json({ matches: rows })
}

export async function POST(req: Request): Promise<Response> {
  ensureGamesRegistered()

  const json = await req.json().catch(() => null)
  const parsed = createSchema.safeParse(json)
  if (!parsed.success) {
    return Response.json({ error: 'validation', details: parsed.error.flatten() }, { status: 400 })
  }

  let matchId: string
  try {
    const result = await createAndStartMatch(parsed.data)
    matchId = result.matchId
  } catch (err) {
    if (err instanceof MatchCreateValidationError) {
      return Response.json(
        { error: 'validation', details: { message: err.message } },
        { status: 400 },
      )
    }
    // Infra failures (DB / Redis / etc) — let Next surface a 500 instead of
    // mislabelling them as validation errors.
    throw err
  }
  log.info('match created via api', { matchId })

  const env = loadEnv()
  fetch(`${env.BASE_URL}/api/matches/${matchId}/tick`, { method: 'POST' }).catch(() => {})

  return Response.json({ matchId, streamUrl: `/api/matches/${matchId}/stream` }, { status: 201 })
}
