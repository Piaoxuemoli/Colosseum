import type { GameEvent, GameType } from '@/platform/core/types'
import { requestAgentDecisionToy } from '@/backend/a2a-core/client'
import { appendEvents, nextSeq } from '@/platform/db/queries/events'
import { recordAgentError } from '@/platform/db/queries/errors'
import { insertEpisodic, listEpisodic, loadSemantic, upsertSemantic } from '@/platform/db/queries/memory'
import { findAgentById } from '@/platform/db/queries/agents'
import { findMatchById, listParticipants } from '@/platform/db/queries/matches'
import { generateImpressionParagraph } from '@/games/poker/memory/summary'
import type { PokerEpisodicEntry } from '@/games/poker/memory/episodic'
import type { PokerSemanticProfile } from '@/games/poker/memory/semantic'
import { getGame } from '@/platform/core/registry'
import { loadEnv } from '@/platform/env'
import { redis } from '@/platform/redis/client'
import { keys } from '@/platform/redis/keys'
import { log } from '@/platform/telemetry/logger'
import { inc, observe } from '@/platform/telemetry/metrics'
import { newEventId } from '@/platform/core/ids'
import { coerceToValidAction } from './action-validator'
import { bucketizeFallbackReason } from './fallback-reasons'
import { finalizeMatch } from './match-lifecycle'
import { publishSse } from './sse-broadcast'
import { moderatorNarrationEvent } from './werewolf-hooks'
import type { WerewolfState } from '@/games/werewolf/engine/types'
import type { PokerActionRecord, PokerState } from '@/games/poker/engine/poker-types'

export type TickResult = { done: boolean }

export async function tickMatch(matchId: string): Promise<TickResult> {
  const locked = await redis.set(keys.matchLock(matchId), '1', 'EX', 60, 'NX')
  if (!locked) {
    log.info('tick skipped: locked', { matchId })
    return { done: false }
  }

  const tickStart = performance.now()
  try {
    const forceEndRequested = await redis.get(keys.matchForceEnd(matchId))
    if (forceEndRequested === '1') {
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
      await redis.del(keys.matchForceEnd(matchId))
      return { done: true }
    }

    const match = await findMatchById(matchId)
    if (!match || match.status !== 'running') return { done: true }

    const stateRaw = await redis.get(keys.matchState(matchId))
    if (!stateRaw) {
      log.error('tick: no state in redis', { matchId })
      return { done: true }
    }

    let state = JSON.parse(stateRaw) as unknown
    const game = getGame(match.gameType as GameType)
    const stopRequested = (await redis.get(keys.matchStopRequested(matchId))) === '1'
    if (stopRequested && game.requestStopAfterHand) {
      state = game.requestStopAfterHand(state)
    }

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
      if (!isAgentEndpointRecordedError(rawCode)) {
        await recordAgentError({
          matchId,
          agentId: actorId,
          layer: 'fallback',
          errorCode: rawCode,
          recoveryAction: action as Record<string, unknown>,
        })
      }
    }

    const { nextState, events } = game.engine.applyAction(state, actorId, action)
    const boundary = game.engine.boundary(state, nextState)

    const augmentedEvents = [...events]
    const thinkingText = agentDecision.thinkingText.trim()
    if (thinkingText.length > 0) {
      augmentedEvents.unshift({
        id: newEventId(),
        matchId,
        gameType: match.gameType as GameType,
        seq: 0,
        occurredAt: new Date().toISOString(),
        kind: 'agent/thinking',
        actorAgentId: actorId,
        payload: {
          handNumber:
            typeof (state as Partial<PokerState>).handNumber === 'number'
              ? (state as Partial<PokerState>).handNumber
              : 0,
          // Werewolf has no "hand"; carry day + phase so the spectator UI can
          // group reasoning by「第 N 夜 / 第 N 天」. Read from the pre-action
          // `state` (the world the agent reasoned about), which is accurate
          // because `s.day += 1` only happens inside `applyAction`'s phase
          // transition. Poker leaves these undefined.
          day: match.gameType === 'werewolf' ? (state as WerewolfState).day : undefined,
          phase: match.gameType === 'werewolf' ? (state as WerewolfState).phase : undefined,
          text: thinkingText,
        },
        visibility: 'public',
        restrictedTo: null,
      })
    }
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

    // Emit a terminal werewolf/game-end event BEFORE finalize so the SSE
    // consumer can reveal roles. Without this, the UI result panel never
    // opens because it waits for ww.winner to be populated by this event.
    if (game.publicStateEvent) {
      augmentedEvents.push({
        ...game.publicStateEvent(nextState),
        id: newEventId(),
        matchId: '',
        seq: 0,
      })
    }

    const nextStateMatchComplete = (nextState as { matchComplete?: boolean }).matchComplete === true
    const isTerminalTransition = boundary === 'match-end' || nextStateMatchComplete
    if (isTerminalTransition && match.gameType === 'werewolf') {
      const ws = nextState as WerewolfState
      augmentedEvents.push({
        gameType: 'werewolf',
        occurredAt: new Date().toISOString(),
        kind: 'werewolf/game-end',
        actorAgentId: null,
        payload: {
          winner: ws.winner,
          actualRoles: ws.roleAssignments,
          totalDays: ws.day,
        },
        visibility: 'public',
        restrictedTo: null,
        id: newEventId(),
        matchId: '',
        seq: 0,
      })
    }

    let seq = await nextSeq(matchId)
    async function appendAndPublish(eventsToAppend: GameEvent[]): Promise<GameEvent[]> {
      const finalEvents = eventsToAppend.map((event) => ({ ...event, matchId, seq: seq++ }))
      await appendEvents(finalEvents)

      for (const event of finalEvents) {
        if (event.visibility === 'public') {
          await publishSse(matchId, { kind: 'event', event })
        }
      }

      return finalEvents
    }

    await appendAndPublish(augmentedEvents)

    if (isTerminalTransition) {
      await redis.set(keys.matchState(matchId), JSON.stringify(nextState), 'EX', 24 * 60 * 60)
      await finalizeMatch(matchId)
      await publishSse(matchId, { kind: 'match-end', winnerAgentId: null })
      inc('tick.count', 1, { gameType, outcome: 'match-end' })
      observe('tick.duration_ms', performance.now() - tickStart, { gameType })
      return { done: true }
    }

    if (boundary === 'hand-end') {
      await persistHandImpressions(matchId, match.gameType as GameType, nextState, game)
    }

    if (boundary === 'hand-end' && game.continueAfterBoundary) {
      const continuation = game.continueAfterBoundary(nextState, 'hand-end')
      if (continuation) {
        await appendAndPublish(
          continuation.events.map((event) => ({
            ...event,
            id: newEventId(),
            matchId: '',
            seq: 0,
          })),
        )
        await redis.set(keys.matchState(matchId), JSON.stringify(continuation.nextState), 'EX', 24 * 60 * 60)

        const continuationTerminal =
          game.engine.boundary(nextState, continuation.nextState) === 'match-end' ||
          (continuation.nextState as { matchComplete?: boolean }).matchComplete === true
        if (continuationTerminal) {
          await finalizeMatch(matchId)
          await publishSse(matchId, { kind: 'match-end', winnerAgentId: null })
          inc('tick.count', 1, { gameType, outcome: 'match-end' })
          observe('tick.duration_ms', performance.now() - tickStart, { gameType })
          return { done: true }
        }

        inc('tick.count', 1, { gameType, outcome: 'continue' })
        observe('tick.duration_ms', performance.now() - tickStart, { gameType })
        return { done: false }
      }
    }

    await redis.set(keys.matchState(matchId), JSON.stringify(nextState), 'EX', 24 * 60 * 60)

    inc('tick.count', 1, { gameType, outcome: 'continue' })
    observe('tick.duration_ms', performance.now() - tickStart, { gameType })
    return { done: false }
  } finally {
    await redis.del(keys.matchLock(matchId))
  }
}

async function persistHandImpressions(
  matchId: string,
  gameType: GameType,
  finalState: unknown,
  game: ReturnType<typeof getGame>,
): Promise<void> {
  if (gameType !== 'poker') return
  const participants = await listParticipants(matchId)
  const agentNames = new Map<string, string>()
  await Promise.all(
    participants.map(async (participant) => {
      const agent = await findAgentById(participant.agentId)
      agentNames.set(participant.agentId, agent?.displayName ?? participant.agentId)
    }),
  )
  const working = buildPokerWorkingMemory(finalState)

  for (const observer of participants) {
    for (const target of participants) {
      if (observer.agentId === target.agentId) continue
      const episodic = game.memory.synthesizeEpisodic({
        working,
        finalState,
        observerAgentId: observer.agentId,
        targetAgentId: target.agentId,
        matchId,
      })
      if (!episodic || typeof episodic !== 'object') continue

      const episodicJson = game.memory.serialize.episodic(episodic)
      await insertEpisodic({
        observerAgentId: observer.agentId,
        targetAgentId: target.agentId,
        matchId,
        gameType,
        entryJson: episodicJson,
        tags: Array.isArray(episodicJson.tags) ? episodicJson.tags.filter((tag): tag is string => typeof tag === 'string') : [],
      })

      const existing = await loadSemantic({
        observerAgentId: observer.agentId,
        targetAgentId: target.agentId,
        gameType,
      })
      const current = existing ? (game.memory.deserialize.semantic(existing.profileJson) as PokerSemanticProfile) : null
      const semantic = game.memory.updateSemantic(current, episodic) as PokerSemanticProfile

      const recentEpisodes = await listEpisodic({
        observerAgentId: observer.agentId,
        targetAgentId: target.agentId,
        gameType,
        limit: 5,
      })
      semantic.note = generateImpressionParagraph({
        targetName: agentNames.get(target.agentId) ?? target.agentId,
        observerName: agentNames.get(observer.agentId) ?? observer.agentId,
        profile: semantic,
        recentEpisodes: recentEpisodes.map((row) => row.entryJson as PokerEpisodicEntry),
      })

      const profileJson = game.memory.serialize.semantic(semantic)
      const observed =
        typeof profileJson.handCount === 'number'
          ? profileJson.handCount
          : typeof profileJson.gamesObserved === 'number'
            ? profileJson.gamesObserved
            : (existing?.gamesObserved ?? 0) + 1

      await upsertSemantic({
        observerAgentId: observer.agentId,
        targetAgentId: target.agentId,
        gameType,
        profileJson,
        gamesObserved: observed,
      })
    }
  }
}

function buildPokerWorkingMemory(state: unknown): {
  matchActionsLog: Array<{ seq: number; kind: string; actorAgentId: string | null; payload: Record<string, unknown> }>
  currentHandNumber: number
} {
  const pokerState = state as Partial<PokerState>
  const actionHistory = Array.isArray(pokerState.actionHistory) ? pokerState.actionHistory : []
  return {
    matchActionsLog: actionHistory.map((record: PokerActionRecord) => ({
      seq: record.seq,
      kind: 'poker/action',
      actorAgentId: record.agentId,
      payload: record.action as unknown as Record<string, unknown>,
    })),
    currentHandNumber: typeof pokerState.handNumber === 'number' ? pokerState.handNumber : 0,
  }
}

type AgentDecisionResult = {
  action: unknown
  fallback: boolean
  errorCode?: string
  thinkingText: string
}

const THINKING_BATCH_MS = 100

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
    return { action: input.fallback(), fallback: true, errorCode: 'agent-token-missing', thinkingText: '' }
  }

  const thinkingPublishes: Array<Promise<void>> = []
  let thinkingBuffer = ''
  let thinkingText = ''
  let thinkingTimer: ReturnType<typeof setTimeout> | null = null

  const flushThinking = () => {
    if (thinkingTimer) {
      clearTimeout(thinkingTimer)
      thinkingTimer = null
    }
    if (thinkingBuffer) {
      thinkingPublishes.push(
        publishSse(input.matchId, { kind: 'thinking-delta', agentId: input.agentId, delta: thinkingBuffer }),
      )
      thinkingBuffer = ''
    }
  }

  const onThinking = (delta: string) => {
    thinkingText += delta
    thinkingBuffer += delta
    if (!thinkingTimer) {
      thinkingTimer = setTimeout(flushThinking, THINKING_BATCH_MS)
    }
  }

  try {
    const env = loadEnv()
    const decision = await requestAgentDecisionToy<{
      action?: unknown
      fallback?: boolean
      errorKind?: string
      thinking?: string
    }>({
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
      onThinking,
    })
    flushThinking()
    await Promise.allSettled(thinkingPublishes)
    if (!decision.action) {
      return { action: input.fallback(), fallback: true, errorCode: 'agent-no-action', thinkingText }
    }
    return {
      action: decision.action,
      fallback: decision.fallback ?? false,
      errorCode: normalizeAgentErrorKind(decision.errorKind),
      thinkingText:
        typeof decision.thinking === 'string' && decision.thinking.trim().length > 0
          ? decision.thinking
          : thinkingText,
    }
  } catch (err) {
    flushThinking()
    await Promise.allSettled(thinkingPublishes)
    log.warn('agent endpoint request failed, using bot fallback', {
      matchId: input.matchId,
      agentId: input.agentId,
      err: String(err),
    })
    return { action: input.fallback(), fallback: true, errorCode: 'agent-endpoint-failed', thinkingText }
  }
}

function normalizeAgentErrorKind(errorKind: string | undefined): string | undefined {
  if (!errorKind) return undefined
  if (errorKind.startsWith('agent-') || errorKind.startsWith('llm-')) return errorKind
  return `agent-${errorKind}`
}

function isAgentEndpointRecordedError(errorCode: string): boolean {
  return errorCode.startsWith('llm-')
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
