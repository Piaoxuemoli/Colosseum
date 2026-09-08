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
import type { GameEvent, GameType } from '@/platform/core/types'
import { v2RestrictedTo, v2Visibility, type V2Event } from '@/platform/engine/contracts-v2'
import { findMatchById } from '@/platform/db/queries/matches'
import { appendEvents } from '@/platform/db/queries/events'
import { ensureGamesRegistered } from '@/platform/instrument'
import { getGameV2 } from '@/platform/core/registry'
import { newEventId } from '@/platform/core/ids'
import { redis } from '@/platform/redis/client'
import { keys } from '@/platform/redis/keys'
import { log } from '@/platform/telemetry/logger'
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
    const gameType = match.gameType as GameType
    const stateRaw = await redis.get(keys.matchState(matchId))
    if (stateRaw) {
      // v2 语义（spec §7）：terminateImmediately（带排名）→ 落库/广播；
      // 旧格式 state 无法被 v2 插件解读时跳过 terminate，仅 finalize 兜底。
      try {
        const plugin = getGameV2(gameType)
        const terminated = plugin.terminateImmediately(JSON.parse(stateRaw))
        if (terminated.ok) {
          await appendV2Events(matchId, gameType, terminated.events)
          for (const event of v2Rows(matchId, gameType, terminated.events)) {
            await publishSse(matchId, { kind: 'event', event })
          }
          await redis.set(keys.matchState(matchId), JSON.stringify(terminated.state), 'EX', 24 * 60 * 60)
        }
      } catch (err) {
        log.warn('force-end: v2 terminateImmediately failed on stored state', { matchId, err: String(err) })
      }
    }

    await finalizeMatch(matchId)
    await publishSse(matchId, { kind: 'match-end', winnerAgentId: null })
    await cleanupRedisKeys(matchId)
    return { ok: true }
  } finally {
    await redis.del(keys.matchLock(matchId))
  }
}

function v2Rows(matchId: string, gameType: GameType, events: readonly V2Event[]): GameEvent[] {
  const occurredAt = new Date().toISOString()
  return events.map((event) => ({
    id: newEventId(),
    matchId,
    gameType,
    seq: event.seq,
    occurredAt,
    kind: `${gameType}:v2:${event.kind}`,
    actorAgentId: event.actorAgentId,
    payload: { ...event.raw },
    visibility: v2Visibility(event.audience),
    restrictedTo: v2RestrictedTo(event.audience),
  }))
}

async function appendV2Events(matchId: string, gameType: GameType, events: readonly V2Event[]): Promise<void> {
  const rows = v2Rows(matchId, gameType, events)
  if (rows.length > 0) await appendEvents(rows)
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
