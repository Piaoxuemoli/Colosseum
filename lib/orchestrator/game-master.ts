import type { GameType } from '@/lib/core/types'
import { requestAgentDecisionToy } from '@/lib/a2a-core/client'
import { appendEvents, nextSeq } from '@/lib/db/queries/events'
import { recordAgentError } from '@/lib/db/queries/errors'
import { findMatchById } from '@/lib/db/queries/matches'
import { getGame } from '@/lib/core/registry'
import { loadEnv } from '@/lib/env'
import { redis } from '@/lib/redis/client'
import { keys } from '@/lib/redis/keys'
import { log } from '@/lib/telemetry/logger'
import { inc, observe } from '@/lib/telemetry/metrics'
import { newEventId } from '@/lib/core/ids'
import { coerceToValidAction } from './action-validator'
import { bucketizeFallbackReason } from './fallback-reasons'
import { finalizeMatch } from './match-lifecycle'
import { publishSse } from './sse-broadcast'
import { moderatorNarrationEvent } from './werewolf-hooks'
import type { WerewolfState } from '@/games/werewolf/engine/types'

export type TickResult = { done: boolean }

export async function tickMatch(matchId: string): Promise<TickResult> {
  const locked = await redis.set(keys.matchLock(matchId), '1', 'EX', 60, 'NX')
  if (!locked) {
    log.info('tick skipped: locked', { matchId })
    return { done: false }
  }

  const tickStart = performance.now()
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
    const gameType = String(match.gameType)

    if (!actorId) {
      await finalizeMatch(matchId)
      await publishSse(matchId, { kind: 'match-end', winnerAgentId: null })
      inc('tick.count', 1, { gameType, outcome: 'finalize' })
      observe('tick.duration_ms', performance.now() - tickStart, { gameType })
      return { done: true }
    }

    const validActions = game.engine.availableActions(state, actorId)
    const agentStart = performance.now()
    const agentDecision = await requestAgentDecision({
      matchId,
      agentId: actorId,
      state,
      validActions,
      timeoutMs: typeof match.config.agentTimeoutMs === 'number' ? match.config.agentTimeoutMs : undefined,
      fallback: () => game.botStrategy.decide(state, validActions as unknown[]),
    })
    observe('agent.request_ms', performance.now() - agentStart, { gameType })
    const { action, layer } = coerceToValidAction(agentDecision.action, validActions, state, game.botStrategy, {
      matchId,
      agentId: actorId,
      layerIfPassed: 'parse',
    })

    if (agentDecision.fallback || layer === 'fallback') {
      const rawCode = agentDecision.errorCode ?? 'agent-invalid-action'
      inc('agent.fallback', 1, { gameType, reason: bucketizeFallbackReason(rawCode) })
      await recordAgentError({
        matchId,
        agentId: actorId,
        layer: 'fallback',
        errorCode: rawCode,
        recoveryAction: action as Record<string, unknown>,
      })
    }

    const { nextState, events } = game.engine.applyAction(state, actorId, action)

    const augmentedEvents = [...events]
    if (match.gameType === 'werewolf') {
      const narrationEvent = moderatorNarrationEvent(
        state as WerewolfState,
        nextState as WerewolfState,
      )
      if (narrationEvent) {
        augmentedEvents.push({
          ...narrationEvent,
          id: newEventId(),
          matchId: '',
          seq: 0,
        })
      }
    }

    let seq = await nextSeq(matchId)
    const finalEvents = augmentedEvents.map((event) => ({ ...event, matchId, seq: seq++ }))
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
      inc('tick.count', 1, { gameType, outcome: 'match-end' })
      observe('tick.duration_ms', performance.now() - tickStart, { gameType })
      return { done: true }
    }

    inc('tick.count', 1, { gameType, outcome: 'continue' })
    observe('tick.duration_ms', performance.now() - tickStart, { gameType })
    return { done: false }
  } finally {
    await redis.del(keys.matchLock(matchId))
  }
}

type AgentDecisionResult = {
  action: unknown
  fallback: boolean
  errorCode?: string
}

async function requestAgentDecision(input: {
  matchId: string
  agentId: string
  state: unknown
  validActions: unknown[]
  timeoutMs?: number
  fallback: () => unknown
}): Promise<AgentDecisionResult> {
  const token = await redis.get(keys.matchToken(input.matchId))
  if (!token) {
    return { action: input.fallback(), fallback: true, errorCode: 'agent-token-missing' }
  }

  const thinkingPublishes: Array<Promise<void>> = []

  try {
    const env = loadEnv()
    const decision = await requestAgentDecisionToy<{ action?: unknown; fallback?: boolean; errorKind?: string }>({
      baseUrl: env.BASE_URL,
      agentId: input.agentId,
      taskId: `task_${input.matchId}_${Date.now()}`,
      matchId: input.matchId,
      matchToken: token,
      timeoutMs: input.timeoutMs,
      message: {
        role: 'user',
        parts: [{ kind: 'data', data: { state: input.state, validActions: input.validActions } }],
      },
      onThinking(delta) {
        thinkingPublishes.push(publishSse(input.matchId, { kind: 'thinking-delta', agentId: input.agentId, delta }))
      },
    })
    await Promise.allSettled(thinkingPublishes)
    if (!decision.action) {
      return { action: input.fallback(), fallback: true, errorCode: 'agent-no-action' }
    }
    return {
      action: decision.action,
      fallback: decision.fallback ?? false,
      errorCode: decision.errorKind ? `agent-${decision.errorKind}` : undefined,
    }
  } catch (err) {
    await Promise.allSettled(thinkingPublishes)
    log.warn('agent endpoint request failed, using bot fallback', {
      matchId: input.matchId,
      agentId: input.agentId,
      err: String(err),
    })
    return { action: input.fallback(), fallback: true, errorCode: 'agent-endpoint-failed' }
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
