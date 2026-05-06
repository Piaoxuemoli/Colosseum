import { and, eq } from 'drizzle-orm'
import { newMatchId } from '@/lib/core/ids'
import type { GameType, MatchConfig, MatchResult } from '@/lib/core/types'
import { db } from '@/lib/db/client'
import { matches, matchParticipants } from '@/lib/db/schema.sqlite'

export type MatchRow = typeof matches.$inferSelect
export type ParticipantRow = typeof matchParticipants.$inferSelect

export type MatchStatus = 'pending' | 'running' | 'completed' | 'errored' | 'aborted_by_errors'

export type NewMatchInput = {
  gameType: GameType
  config: MatchConfig
  participants: Array<{
    agentId: string
    seatIndex: number
    initialData?: Record<string, unknown>
  }>
}

export async function createMatch(input: NewMatchInput): Promise<{ matchId: string }> {
  const matchId = newMatchId()

  await db.insert(matches).values({
    id: matchId,
    gameType: input.gameType,
    status: 'pending',
    config: input.config,
    startedAt: new Date(),
    completedAt: null,
    winnerFaction: null,
    finalRanking: null,
    stats: null,
  })

  for (const participant of input.participants) {
    await db.insert(matchParticipants).values({
      matchId,
      agentId: participant.agentId,
      seatIndex: participant.seatIndex,
      initialData: participant.initialData ?? null,
    })
  }

  return { matchId }
}

export async function findMatchById(id: string): Promise<MatchRow | undefined> {
  const rows = await db.select().from(matches).where(eq(matches.id, id)).limit(1)
  return rows[0]
}

export async function listParticipants(matchId: string): Promise<ParticipantRow[]> {
  return db.select().from(matchParticipants).where(eq(matchParticipants.matchId, matchId))
}

export async function updateMatchStatus(id: string, status: MatchStatus): Promise<void> {
  await db.update(matches).set({ status }).where(eq(matches.id, id))
}

export async function finalizeMatchRow(input: {
  matchId: string
  winnerFaction: string | null
  result: MatchResult
  stats?: Record<string, unknown>
}): Promise<void> {
  await db
    .update(matches)
    .set({
      status: 'completed',
      completedAt: new Date(),
      winnerFaction: input.winnerFaction,
      finalRanking: input.result as unknown as Record<string, unknown>,
      stats: input.stats ?? null,
    })
    .where(eq(matches.id, input.matchId))
}

export async function isAgentParticipant(matchId: string, agentId: string): Promise<boolean> {
  const rows = await db
    .select()
    .from(matchParticipants)
    .where(and(eq(matchParticipants.matchId, matchId), eq(matchParticipants.agentId, agentId)))
    .limit(1)

  return rows.length > 0
}
