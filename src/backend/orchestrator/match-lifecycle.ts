/**
 * 对局生命周期（spec: docs/specs/engine2-integration.md §7）。
 *
 * createAndStartMatch 一律走 v2 插件面（registry v2 创建），match.config 记
 * engineVersion: 2；开局事件即引擎事件（GM 不再自造 seq:0 事件）。
 * finalizeMatch 的排名来自 classify().finished.result（engine2 结算）；
 * 遗留旧格式运行中对局由 force-end 兜底（不依赖 v2 state 形状）。
 */

import { newEventId, newMatchToken } from '@/platform/core/ids'
import { getGameV2 } from '@/platform/core/registry'
import { defaultMatchConfig, type GameEvent, type GameType, type MatchConfig, type MatchResult } from '@/platform/core/types'
import { v2RestrictedTo, v2Visibility, type V2Event } from '@/platform/engine/contracts-v2'
import { appendEvents } from '@/platform/db/queries/events'
import { deleteWorkingMemory } from '@/platform/db/queries/memory'
import {
  createMatch,
  finalizeMatchRow,
  findMatchById,
  listParticipants,
  updateMatchStatus,
} from '@/platform/db/queries/matches'
import { ensureGamesRegistered } from '@/platform/instrument'
import { redis } from '@/platform/redis/client'
import { keys } from '@/platform/redis/keys'
import { log } from '@/platform/telemetry/logger'
import { MatchCreateValidationError, validateMatchCreate } from './match-lifecycle-validation'

export type CreateMatchInput = {
  gameType: GameType
  agentIds: string[]
  moderatorAgentId?: string | null
  config?: Partial<MatchConfig>
  keyring?: Record<string, string>
  engineConfig?: Record<string, unknown>
}

/**
 * v2 对局在 matches.config 上盖的版本戳（spec §7）。moderatorAgentId 为
 * R3-3 旁白钩子 GM 侧解析主持人用（狼人杀；未提供时不写入该键）。
 */
export type V2MatchConfig = MatchConfig & { engineVersion: 2; moderatorAgentId?: string }

export async function createAndStartMatch(input: CreateMatchInput): Promise<{ matchId: string; token: string }> {
  ensureGamesRegistered()
  validateMatchCreate(input.gameType, {
    agentIds: input.agentIds,
    moderatorAgentId: input.moderatorAgentId ?? null,
    engineConfig: input.engineConfig ?? {},
  })

  const plugin = getGameV2(input.gameType)
  const created = plugin.createMatch(
    {
      ...(input.engineConfig ?? {}),
      moderatorAgentId: input.moderatorAgentId ?? null,
    },
    input.agentIds,
  )
  if (!created.ok) {
    throw new MatchCreateValidationError(`[${created.rejection.code}] ${created.rejection.message}`)
  }

  const config: V2MatchConfig = {
    ...defaultMatchConfig(),
    ...(input.config ?? {}),
    engineVersion: 2,
    ...(input.moderatorAgentId ? { moderatorAgentId: input.moderatorAgentId } : {}),
  }
  const { matchId } = await createMatch({
    gameType: input.gameType,
    config,
    participants: input.agentIds.map((agentId, seatIndex) => ({ agentId, seatIndex })),
  })

  const token = newMatchToken()

  await redis.set(keys.matchState(matchId), JSON.stringify(created.state), 'EX', 24 * 60 * 60)
  await redis.set(keys.matchToken(matchId), token, 'EX', 24 * 60 * 60)
  if (input.keyring && Object.keys(input.keyring).length > 0) {
    await redis.hset(keys.matchKeyring(matchId), input.keyring)
    await redis.expire(keys.matchKeyring(matchId), 24 * 60 * 60)
  }

  const occurredAt = new Date().toISOString()
  const startEvents: GameEvent[] = created.events.map((event) =>
    v2EventRow({ matchId, gameType: input.gameType, event, occurredAt }),
  )
  await appendEvents(startEvents)

  await updateMatchStatus(matchId, 'running')
  log.info('match created (engine2)', { matchId, gameType: input.gameType, startEvents: startEvents.length })

  return { matchId, token }
}

function v2EventRow(input: {
  matchId: string
  gameType: GameType
  event: V2Event
  occurredAt: string
}): GameEvent {
  return {
    id: newEventId(),
    matchId: input.matchId,
    gameType: input.gameType,
    seq: input.event.seq,
    occurredAt: input.occurredAt,
    kind: `${input.gameType}:v2:${input.event.kind}`,
    actorAgentId: input.event.actorAgentId,
    payload: { ...input.event.raw },
    visibility: v2Visibility(input.event.audience),
    restrictedTo: v2RestrictedTo(input.event.audience),
  }
}

export async function finalizeMatch(matchId: string, options?: { result?: MatchResult }): Promise<void> {
  const match = await findMatchById(matchId)
  if (!match) return

  const stateRaw = await redis.get(keys.matchState(matchId))
  if (!stateRaw) {
    await updateMatchStatus(matchId, 'errored')
    return
  }

  const isV2 = match.config?.engineVersion === 2
  let result: MatchResult | undefined = options?.result

  if (result === undefined && isV2) {
    try {
      const plugin = getGameV2(match.gameType as GameType)
      const classification = plugin.classify(JSON.parse(stateRaw))
      if (classification.kind === 'finished') result = classification.result
    } catch (err) {
      log.warn('finalize: v2 classify failed, falling back to empty ranking', { matchId, err: String(err) })
    }
  }
  // 遗留旧格式（v1）对局：旧引擎 finalize 已随 v1 引擎删除，统一走空排名兜底。

  if (result === undefined) {
    result = { winnerFaction: null, ranking: [], stats: undefined }
  }

  await finalizeMatchRow({ matchId, winnerFaction: result.winnerFaction, result })
  await redis.del(keys.matchState(matchId))
  await redis.del(keys.matchStopRequested(matchId))
  await redis.del(keys.matchKeyring(matchId))
  await redis.del(keys.matchToken(matchId))

  const participants = await listParticipants(matchId)
  for (const participant of participants) {
    await deleteWorkingMemory(participant.agentId, matchId)
  }

  log.info('match finalized', { matchId, winnerFaction: result.winnerFaction })
}
