import { desc, eq } from 'drizzle-orm'
import { newId } from '@/lib/core/ids'
import { db } from '@/lib/db/client'
import { agentErrors } from '@/lib/db/schema.sqlite'

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
