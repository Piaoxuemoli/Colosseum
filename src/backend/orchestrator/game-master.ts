/**
 * GM v2 驱动循环（spec: docs/specs/engine2-integration.md §5）。
 *
 * v2 是唯一运行时：本文件只驱动 GameModuleV2 插件面，不含任何
 * `gameType === 'xxx'` 分支——跨游戏差异全部在各游戏的 plugin-v2 里。
 *
 * 事件信封（spec §3）：engine2 事件落库 kind = `${gameType}:v2:${kind}`，
 * visibility/restrictedTo 由 audience 派生，payload 保留引擎事件本体（含
 * audience），seq 沿用引擎事件序；SSE 全量广播（含 restricted）。
 * agent 决策上下文只允许由 visibleEvents(all, actorId) 重建（spec §1.3）。
 */

import type { GameEvent, GameType, MatchResult } from '@/platform/core/types'
import type { V2AgentDecisionData, V2Event } from '@/platform/engine/contracts-v2'
import { v2RestrictedTo, v2Visibility } from '@/platform/engine/contracts-v2'
import { requestAgentDecisionToy } from '@/backend/a2a-core/client'
import { appendEvents, listMatchEvents } from '@/platform/db/queries/events'
import { recordAgentError } from '@/platform/db/queries/errors'
import { insertEpisodic, listEpisodic, loadSemantic, upsertSemantic } from '@/platform/db/queries/memory'
import { findAgentById } from '@/platform/db/queries/agents'
import { findMatchById, listParticipants } from '@/platform/db/queries/matches'
import { getGameV2 } from '@/platform/core/registry'
import { ensureGamesRegistered } from '@/platform/instrument'
import { loadEnv } from '@/platform/env'
import { redis } from '@/platform/redis/client'
import { keys } from '@/platform/redis/keys'
import { log } from '@/platform/telemetry/logger'
import { inc, observe } from '@/platform/telemetry/metrics'
import { newEventId } from '@/platform/core/ids'
import { finalizeMatch } from './match-lifecycle'
import { publishSse } from './sse-broadcast'
import { bucketizeFallbackReason } from './fallback-reasons'

export type TickResult = { done: boolean }

/** agent 消息中可见事件窗口（spec §4：最近 N 条，须含当前阶段上下文）。 */
const AGENT_EVENTS_WINDOW = 200

type V2Plugin = ReturnType<typeof getGameV2>

export async function tickMatch(matchId: string): Promise<TickResult> {
  ensureGamesRegistered()
  const locked = await redis.set(keys.matchLock(matchId), '1', 'EX', 60, 'NX')
  if (!locked) {
    log.info('tick skipped: locked', { matchId })
    return { done: false }
  }

  const tickStart = performance.now()
  try {
    const forceEndRequested = await redis.get(keys.matchForceEnd(matchId))
    if (forceEndRequested === '1') {
      await executeForceEnd(matchId)
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

    const gameType = match.gameType as GameType
    const plugin = getGameV2(gameType)
    let state: unknown = JSON.parse(stateRaw)

    // stopRequested → requestStopAfterCurrentHand（状态不变则照常推进）
    const stopRequested = (await redis.get(keys.matchStopRequested(matchId))) === '1'
    if (stopRequested) {
      const stop = plugin.requestStopAfterCurrentHand(state)
      if (stop.events.length > 0) {
        await persistAndPublish(matchId, gameType, stop.events, { isDefault: false })
      }
      state = stop.state
    }

    const classification = plugin.classify(state)
    if (classification.kind === 'finished') {
      await finalizeMatch(matchId, { result: classification.result })
      await publishSse(matchId, { kind: 'match-end', winnerAgentId: null })
      inc('tick.count', 1, { gameType, outcome: 'finalize' })
      observe('tick.duration_ms', performance.now() - tickStart, { gameType })
      return { done: true }
    }

    const actorId = classification.actorAgentId
    const legalActions = plugin.legalActions(state, actorId)
    const decisionContext = plugin.decisionContext(state, actorId)

    // agent 决策上下文唯一真相：visibleEvents(fullStream, actorId) 最近 N 条
    const fullStream = (await listMatchEvents(matchId)).map((event) => event.payload)
    const visibleEvents = plugin.visibleEventsFor(fullStream, actorId).slice(-AGENT_EVENTS_WINDOW)

    const timeoutMs = typeof match.config.agentTimeoutMs === 'number' ? match.config.agentTimeoutMs : undefined
    const agentStart = performance.now()
    const decision = await requestAgentDecision({
      matchId,
      agentId: actorId,
      events: visibleEvents,
      legalActions,
      decisionContext,
      gameInfo: plugin.gameInfo(state),
      timeoutMs,
    })
    observe('agent.request_ms', performance.now() - agentStart, { gameType })

    // 校验链（spec §4）：normalizeAction → applyAction；失败 → applyDefaultAction
    let applied: { ok: true; state: unknown; events: V2Event[] } | null = null
    let usedDefault = false
    let rejectionMessage: string | null = null

    if (decision.action !== null && decision.action !== undefined) {
      const normalized = plugin.normalizeAction(decision.action, state, actorId)
      if (normalized.ok) {
        const outcome = plugin.applyAction(state, actorId, normalized.action)
        if (outcome.ok) {
          applied = outcome
        } else {
          rejectionMessage = `${outcome.rejection.code}: ${outcome.rejection.message}`
        }
      } else {
        rejectionMessage = `${normalized.rejection.code}: ${normalized.rejection.message}`
      }
    }

    if (!applied) {
      const outcome = plugin.applyDefaultAction(state)
      if (!outcome.ok) {
        log.error('tick: applyDefaultAction rejected — engine invariant broken', {
          matchId,
          gameType,
          rejection: outcome.rejection,
        })
        await finalizeMatch(matchId, {})
        await publishSse(matchId, { kind: 'match-end', winnerAgentId: null })
        return { done: true }
      }
      applied = outcome
      usedDefault = true
    }

    if (decision.fallback || usedDefault) {
      const rawCode = decision.errorCode ?? 'agent-invalid-action'
      inc('agent.fallback', 1, { gameType, reason: bucketizeFallbackReason(rawCode) })
      if (!isAgentEndpointRecordedError(rawCode)) {
        await recordAgentError({
          matchId,
          agentId: actorId,
          layer: 'fallback',
          errorCode: rawCode,
          recoveryAction: applied.events[0]?.raw ?? null,
        })
      }
    } else if (rejectionMessage !== null) {
      log.warn('tick: agent action rejected, default applied', { matchId, agentId: actorId, rejectionMessage })
    }

    // 事件批量落库 + SSE；thinking 事件由 GM 合成（seq 经插件预留，保持单调）
    let nextState = applied.state
    const engineEvents = applied.events
    const thinkingText = decision.thinkingText.trim()
    const thinkingEvent =
      thinkingText.length > 0
        ? makeThinkingEvent(matchId, gameType, actorId, plugin.stateSummary(state), thinkingText)
        : null
    if (thinkingEvent) {
      const reserved = plugin.reserveEventSeq(nextState)
      nextState = reserved.state
      thinkingEvent.seq = reserved.seq
    }
    await persistAndPublish(matchId, gameType, engineEvents, {
      isDefault: usedDefault,
      extra: thinkingEvent ? [thinkingEvent] : [],
    })

    // 游戏专属钩子（印象等）：IO 在 GM
    plugin.onEventsBatch(nextState, engineEvents)
    const impressions = plugin.impressions
    if (impressions) {
      for (const signal of impressions.fromBatch(nextState, engineEvents, fullStream)) {
        await persistImpressions(matchId, gameType, signal, impressions.memory)
      }
    }

    await redis.set(keys.matchState(matchId), JSON.stringify(nextState), 'EX', 24 * 60 * 60)

    const nextClassification = plugin.classify(nextState)
    if (nextClassification.kind === 'finished') {
      await finalizeMatch(matchId, { result: nextClassification.result })
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

// ---------------------------------------------------------------------------
// force-end（spec §5/§7：terminateImmediately + 排名）
// ---------------------------------------------------------------------------

async function executeForceEnd(matchId: string): Promise<void> {
  const match = await findMatchById(matchId)
  if (!match || match.status !== 'running') return

  const gameType = match.gameType as GameType
  const plugin = getGameV2(gameType)
  const stateRaw = await redis.get(keys.matchState(matchId))
  if (!stateRaw) {
    // 遗留旧格式对局兜底：无 state 也能终结（spec §1）
    await finalizeMatch(matchId, {})
    await publishSse(matchId, { kind: 'match-end', winnerAgentId: null })
    return
  }

  let state: unknown
  try {
    state = JSON.parse(stateRaw)
  } catch {
    state = null
  }

  let result: MatchResult | undefined
  if (state !== null) {
    try {
      const terminated = plugin.terminateImmediately(state)
      if (terminated.ok) {
        await persistAndPublish(matchId, gameType, terminated.events, { isDefault: false })
        await redis.set(keys.matchState(matchId), JSON.stringify(terminated.state), 'EX', 24 * 60 * 60)
        const classification = plugin.classify(terminated.state)
        if (classification.kind === 'finished') result = classification.result
      }
    } catch (err) {
      // 旧格式 state 可能无法被 v2 插件解读：跳过 terminate，直接 finalize 兜底
      log.warn('force-end: terminateImmediately failed on stored state', { matchId, err: String(err) })
    }
  }

  await finalizeMatch(matchId, result ? { result } : {})
  await publishSse(matchId, { kind: 'match-end', winnerAgentId: null })
}

// ---------------------------------------------------------------------------
// 事件信封（spec §3）
// ---------------------------------------------------------------------------

function v2EventRow(input: {
  matchId: string
  gameType: GameType
  event: V2Event
  occurredAt: string
  isDefault: boolean
}): GameEvent {
  const payload = input.isDefault
    ? { ...input.event.raw, isDefault: true }
    : { ...input.event.raw }
  return {
    id: newEventId(),
    matchId: input.matchId,
    gameType: input.gameType,
    seq: input.event.seq,
    occurredAt: input.occurredAt,
    kind: `${input.gameType}:v2:${input.event.kind}`,
    actorAgentId: input.event.actorAgentId,
    payload,
    visibility: v2Visibility(input.event.audience),
    restrictedTo: v2RestrictedTo(input.event.audience),
  }
}

function makeThinkingEvent(
  matchId: string,
  gameType: GameType,
  actorId: string,
  summary: { handNumber: number; day: number; phase: string },
  text: string,
): GameEvent {
  return {
    id: newEventId(),
    matchId,
    gameType,
    seq: 0, // 由调用方经 plugin.reserveEventSeq 填入预留序号
    occurredAt: new Date().toISOString(),
    kind: 'agent/thinking',
    actorAgentId: actorId,
    payload: {
      handNumber: summary.handNumber,
      day: summary.day,
      phase: summary.phase,
      text,
    },
    visibility: 'public',
    restrictedTo: null,
  }
}

/**
 * 事件批量落库 + SSE 全量广播（含 restricted，payload 保留 audience——
 * 单用户私有部署，观战端=所有者，过滤在前端；agent 端永不消费 SSE）。
 */
async function persistAndPublish(
  matchId: string,
  gameType: GameType,
  events: readonly V2Event[],
  options: { isDefault: boolean; extra?: GameEvent[] },
): Promise<GameEvent[]> {
  const occurredAt = new Date().toISOString()
  const rows = events.map((event) =>
    v2EventRow({ matchId, gameType, event, occurredAt, isDefault: options.isDefault }),
  )
  const all = [...(options.extra ?? []), ...rows]
  if (all.length > 0) await appendEvents(all)
  for (const event of all) {
    await publishSse(matchId, { kind: 'event', event })
  }
  return all
}

// ---------------------------------------------------------------------------
// 印象持久化（IO 在 GM；游戏语义在插件）
// ---------------------------------------------------------------------------

async function persistImpressions(
  matchId: string,
  gameType: GameType,
  signal: {
    handNumber: number
    workingLog: Array<{ seq: number; kind: string; actorAgentId: string | null; payload: Record<string, unknown> }>
    finalStateFor: (targetAgentId: string) => unknown
  },
  memory: NonNullable<V2Plugin['impressions']>['memory'],
): Promise<void> {
  const participants = await listParticipants(matchId)
  const agentNames = new Map<string, string>()
  await Promise.all(
    participants.map(async (participant) => {
      const agent = await findAgentById(participant.agentId)
      agentNames.set(participant.agentId, agent?.displayName ?? participant.agentId)
    }),
  )
  const working = {
    matchActionsLog: signal.workingLog,
    currentHandNumber: signal.handNumber,
  }

  for (const observer of participants) {
    for (const target of participants) {
      if (observer.agentId === target.agentId) continue
      const episodic = memory.synthesizeEpisodic({
        working,
        finalState: signal.finalStateFor(target.agentId),
        observerAgentId: observer.agentId,
        targetAgentId: target.agentId,
        matchId,
      })
      if (episodic === null || episodic === undefined) continue

      const entryJson = memory.serializeEpisodic(episodic)
      await insertEpisodic({
        observerAgentId: observer.agentId,
        targetAgentId: target.agentId,
        matchId,
        gameType,
        entryJson,
        tags: Array.isArray(entryJson.tags) ? entryJson.tags.filter((tag): tag is string => typeof tag === 'string') : [],
      })

      const existing = await loadSemantic({
        observerAgentId: observer.agentId,
        targetAgentId: target.agentId,
        gameType,
      })
      const current = existing ? memory.deserializeSemantic(existing.profileJson) : null
      const semantic = memory.updateSemantic(current, episodic)

      const recentEpisodes = await listEpisodic({
        observerAgentId: observer.agentId,
        targetAgentId: target.agentId,
        gameType,
        limit: 5,
      })
      const note = memory.renderNote({
        observerName: agentNames.get(observer.agentId) ?? observer.agentId,
        targetName: agentNames.get(target.agentId) ?? target.agentId,
        semantic,
        recentEpisodes: recentEpisodes.map((row) => row.entryJson),
      })

      const profileJson = { ...memory.serializeSemantic(semantic), note }
      const observed =
        memory.handCountOf(profileJson) ??
        (typeof existing?.gamesObserved === 'number' ? existing.gamesObserved + 1 : 1)

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

// ---------------------------------------------------------------------------
// Agent 决策请求（v2 消息契约，spec §4）
// ---------------------------------------------------------------------------

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
  events: Record<string, unknown>[]
  legalActions: V2AgentDecisionData['legalActions']
  decisionContext: Record<string, unknown>
  gameInfo: Record<string, unknown>
  timeoutMs?: number
}): Promise<AgentDecisionResult> {
  const token = await redis.get(keys.matchToken(input.matchId))
  if (!token) {
    return { action: null, fallback: true, errorCode: 'agent-token-missing', thinkingText: '' }
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
        parts: [
          {
            kind: 'data',
            data: {
              engineVersion: 2,
              events: input.events,
              legalActions: input.legalActions,
              decisionContext: input.decisionContext,
              gameInfo: input.gameInfo,
            } satisfies V2AgentDecisionData,
          },
        ],
      },
      onThinking,
    })
    flushThinking()
    await Promise.allSettled(thinkingPublishes)
    if (decision.action === null || decision.action === undefined) {
      return { action: null, fallback: true, errorCode: 'agent-no-action', thinkingText }
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
    log.warn('agent endpoint request failed, using engine default action', {
      matchId: input.matchId,
      agentId: input.agentId,
      err: String(err),
    })
    return { action: null, fallback: true, errorCode: 'agent-endpoint-failed', thinkingText }
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
  ensureGamesRegistered()
  const maxTicks = options?.maxTicks ?? 1_000
  const intervalMs = options?.intervalMs ?? 0

  for (let i = 0; i < maxTicks; i++) {
    const result = await tickMatch(matchId)
    if (result.done) return
    if (intervalMs > 0) await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }

  log.warn('runMatchToCompletion: maxTicks reached', { matchId, maxTicks })
}
