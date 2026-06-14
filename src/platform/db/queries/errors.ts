import { desc, eq, sql } from 'drizzle-orm'
import { newId } from '@/platform/core/ids'
import { db } from '@/platform/db/client'
import { agentErrors } from '@/platform/db/schema.sqlite'

export type ErrorLayer = 'http' | 'structured' | 'parse' | 'validate' | 'fallback'

export async function recordAgentError(input: {
  matchId: string
  agentId: string
  layer: ErrorLayer
  errorCode: string
  rawResponse?: string | null
  recoveryAction?: Record<string, unknown> | null
}): Promise<void> {
  await db.insert(agentErrors).values({
    id: newId(),
    matchId: input.matchId,
    agentId: input.agentId,
    occurredAt: new Date(),
    layer: input.layer,
    errorCode: input.errorCode,
    rawResponse: input.rawResponse?.slice(0, 2000) ?? null,
    recoveryAction: input.recoveryAction ?? null,
  })
}

export async function listErrorsByMatch(matchId: string, limit = 20): Promise<(typeof agentErrors.$inferSelect)[]> {
  return db
    .select()
    .from(agentErrors)
    .where(eq(agentErrors.matchId, matchId))
    .orderBy(desc(agentErrors.occurredAt))
    .limit(limit)
}

export async function countErrorsByMatch(matchId: string): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)` })
    .from(agentErrors)
    .where(eq(agentErrors.matchId, matchId))
  return Number(rows[0]?.count ?? 0)
}
