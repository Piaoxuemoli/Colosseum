import { eq } from 'drizzle-orm'
import { db } from '@/platform/db/client'
import {
  agentErrors,
  episodicMemory,
  gameEvents,
  matchParticipants,
  matches,
  workingMemory,
} from '@/platform/db/schema.sqlite'
import { findMatchById } from '@/platform/db/queries/matches'
import { ensureGamesRegistered } from '@/platform/instrument'
import { redis } from '@/platform/redis/client'
import { keys } from '@/platform/redis/keys'
import { publishSse } from './sse-broadcast'
import { finalizeMatch } from './match-lifecycle'

export async function forceEndMatch(matchId: string): Promise<{ ok: boolean; viaFlag?: boolean }> {
  const match = await findMatchById(matchId)
  if (!match) throw new Error('not found')
  if (match.status !== 'running') return { ok: true }

  await ensureGamesRegistered()

  const lock = await redis.set(keys.matchLock(matchId), 'force-end', 'EX', 10, 'NX')
  if (!lock) {
    await redis.set(keys.matchForceEnd(matchId), '1', 'EX', 60)
    return { ok: true, viaFlag: true }
  }

  try {
    const stateRaw = await redis.get(keys.matchState(matchId))
    if (stateRaw) {
      const state = JSON.parse(stateRaw) as Record<string, unknown>
      state.matchComplete = true
      state.currentActor = null
      state.stopRequested = true
      await redis.set(keys.matchState(matchId), JSON.stringify(state), 'EX', 24 * 60 * 60)
    }

    await finalizeMatch(matchId)
    await publishSse(matchId, { kind: 'match-end', winnerAgentId: null })
    await cleanupRedisKeys(matchId)
    return { ok: true }
  } finally {
    await redis.del(keys.matchLock(matchId))
  }
}

export async function deleteMatch(matchId: string): Promise<void> {
  const match = await findMatchById(matchId)
  if (!match) throw new Error('not found')

  if (match.status === 'running') {
    const result = await forceEndMatch(matchId)
    if (result.viaFlag) {
      throw new Error('match is being force-ended, retry delete shortly')
    }
  }

  await db.delete(gameEvents).where(eq(gameEvents.matchId, matchId))
  await db.delete(agentErrors).where(eq(agentErrors.matchId, matchId))
  await db.delete(workingMemory).where(eq(workingMemory.matchId, matchId))
  await db.delete(episodicMemory).where(eq(episodicMemory.matchId, matchId))
  await db.delete(matchParticipants).where(eq(matchParticipants.matchId, matchId))
  await db.delete(matches).where(eq(matches.id, matchId))
  await cleanupRedisKeys(matchId)
}

async function cleanupRedisKeys(matchId: string): Promise<void> {
  await redis.del(
    keys.matchState(matchId),
    keys.matchStopRequested(matchId),
    keys.matchToken(matchId),
    keys.matchKeyring(matchId),
    keys.matchLock(matchId),
    keys.matchForceEnd(matchId),
  )
}
