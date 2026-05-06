import type { GameType } from '@/lib/core/types'
import { appendEvents, nextSeq } from '@/lib/db/queries/events'
import { recordAgentError } from '@/lib/db/queries/errors'
import { findMatchById } from '@/lib/db/queries/matches'
import { getGame } from '@/lib/core/registry'
import { redis } from '@/lib/redis/client'
import { keys } from '@/lib/redis/keys'
import { log } from '@/lib/telemetry/logger'
import { coerceToValidAction } from './action-validator'
import { finalizeMatch } from './match-lifecycle'
import { publishSse } from './sse-broadcast'

export type TickResult = { done: boolean }

export async function tickMatch(matchId: string): Promise<TickResult> {
  const locked = await redis.set(keys.matchLock(matchId), '1', 'EX', 60, 'NX')
  if (!locked) {
    log.info('tick skipped: locked', { matchId })
    return { done: false }
  }

  try {
    const match = await findMatchById(matchId)
    if (!match || match.status !== 'running') return { done: true }

    const stateRaw = await redis.get(keys.matchState(matchId))
    if (!stateRaw) {
      log.error('tick: no state in redis', { matchId })
      return { done: true }
    }

    const state = JSON.parse(stateRaw) as unknown
    const game = getGame(match.gameType as GameType)
    const actorId = game.engine.currentActor(state)

    if (!actorId) {
      await finalizeMatch(matchId)
      await publishSse(matchId, { kind: 'match-end', winnerAgentId: null })
      return { done: true }
    }

    const validActions = game.engine.availableActions(state, actorId)
    const botDecision = game.botStrategy.decide(state, validActions as unknown[])
    const { action, layer } = coerceToValidAction(botDecision, validActions, state, game.botStrategy, {
      matchId,
      agentId: actorId,
      layerIfPassed: 'parse',
    })

    if (layer === 'fallback') {
      await recordAgentError({
        matchId,
        agentId: actorId,
        layer: 'fallback',
        errorCode: 'bot-invalid-action',
        recoveryAction: action as Record<string, unknown>,
      })
    }

    const { nextState, events } = game.engine.applyAction(state, actorId, action)
    let seq = await nextSeq(matchId)
    const finalEvents = events.map((event) => ({ ...event, matchId, seq: seq++ }))
    await appendEvents(finalEvents)

    for (const event of finalEvents) {
      if (event.visibility === 'public') {
        await publishSse(matchId, { kind: 'event', event })
      }
    }

    await redis.set(keys.matchState(matchId), JSON.stringify(nextState), 'EX', 24 * 60 * 60)

    const boundary = game.engine.boundary(state, nextState)
    if (boundary === 'match-end') {
      await finalizeMatch(matchId)
      await publishSse(matchId, { kind: 'match-end', winnerAgentId: null })
      return { done: true }
    }

    return { done: false }
  } finally {
    await redis.del(keys.matchLock(matchId))
  }
}

export async function runMatchToCompletion(
  matchId: string,
  options?: { maxTicks?: number; intervalMs?: number },
): Promise<void> {
  const maxTicks = options?.maxTicks ?? 1_000
  const intervalMs = options?.intervalMs ?? 0

  for (let i = 0; i < maxTicks; i++) {
    const result = await tickMatch(matchId)
    if (result.done) return
    if (intervalMs > 0) await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }

  log.warn('runMatchToCompletion: maxTicks reached', { matchId, maxTicks })
}
