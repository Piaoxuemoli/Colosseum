/**
 * 简化阿瓦隆 engine2 平台插件（spec: docs/specs/engine2-integration.md §2）。
 *
 * R3-2 新品类冒烟接入点：纯函数包装 `src/games/avalon/engine2`，无 IO。
 * 跨游戏差异（固定 5 人板、LLM 别名容错、强制终局语义）全部收敛于此，
 * GM 无 gameType 分支——平台核心零改动即可驱动本品类（NFR-08 验证形态）。
 */

import type { GameType, MatchResult } from '@/platform/core/types'
import type {
  GameModuleV2,
  V2ActionSpec,
  V2Audience,
  V2Event,
  V2NormalizeResult,
} from '@/platform/engine/contracts-v2'
import {
  AVALON_BOARD_SEATS,
  applyAction as engineApplyAction,
  applyDefaultAction as engineApplyDefault,
  availableActions,
  createMatch as engineCreateMatch,
  failCount,
  factionOf,
  normalizeAction as engineNormalizeAction,
  successCount,
  terminateImmediately as engineTerminate,
  visibleEvents as engineVisibleEvents,
} from '../engine2'
import type {
  ActionOption,
  AvalonAction,
  AvalonActionType,
  AvalonEngineState,
  AvalonEvent,
} from '../engine2'
import { avalonPresentation } from './presentation-v2'

const gameType: GameType = 'avalon'

/** FNV-1a 32 位字符串哈希（种子字符串 → 引擎数值种子；与狼人杀实现同族、独立复制）。 */
function seedFromString(seed: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    h = (h ^ seed.charCodeAt(i)) >>> 0
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

// ---------------------------------------------------------------------------
// 事件信封：AvalonEvent → V2Event
// ---------------------------------------------------------------------------

function toAudience(event: AvalonEvent): V2Audience {
  const audience = event.audience
  switch (audience.kind) {
    case 'public':
      return { kind: 'public' }
    case 'delayed-public':
      return { kind: 'delayed-public' }
    case 'role-self':
      return { kind: 'self', scope: 'role-self', agentId: audience.playerId }
  }
}

function toV2Event(event: AvalonEvent): V2Event {
  return {
    kind: event.kind,
    seq: event.seq,
    actorAgentId: event.actorId,
    isDefault: event.isDefault === true,
    audience: toAudience(event),
    raw: { ...event },
  }
}

function isAvalonEventPayload(value: unknown): value is AvalonEvent {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<AvalonEvent>
  return (
    typeof candidate.kind === 'string' &&
    typeof candidate.seq === 'number' &&
    typeof candidate.day === 'number' &&
    typeof candidate.audience === 'object' &&
    candidate.audience !== null &&
    typeof (candidate as { payload?: unknown }).payload === 'object' &&
    (candidate as { payload?: unknown }).payload !== null
  )
}

// ---------------------------------------------------------------------------
// LLM 别名容错（上游适配边界：语境消歧由 availableActions 交集完成）
// ---------------------------------------------------------------------------

const TYPE_ALIASES: Record<string, AvalonActionType[]> = {
  proposeteam: ['proposeTeam'],
  propose: ['proposeTeam'],
  team: ['proposeTeam'],
  nominateteam: ['proposeTeam'],
  提名: ['proposeTeam'],
  提案: ['proposeTeam'],
  vote: ['vote'],
  teamvote: ['vote'],
  voteteam: ['vote'],
  表决: ['vote'],
  投票: ['vote'],
  quest: ['quest'],
  choose: ['quest'],
  questchoice: ['quest'],
  任务: ['quest'],
}

const APPROVE_WORDS = new Set(['approve', 'yes', 'for', '赞同', '赞成', '同意', '通过'])
const REJECT_WORDS = new Set(['reject', 'no', 'against', '反对', '否决', '否'])
const SUCCESS_WORDS = new Set(['success', 'succeed', 'win', '成功'])
const FAIL_WORDS = new Set(['fail', 'failure', 'sabotage', '失败'])

function shapeKey(rawType: string): string {
  return rawType.replace(/[/_-]/g, '').toLowerCase()
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

/** 各类字段的别名容错提取；返回 undefined 表示无法归一。 */
function boolFromWords(value: unknown, truthy: ReadonlySet<string>, falsy: ReadonlySet<string>): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return undefined
  const key = value.trim().toLowerCase()
  if (truthy.has(key)) return true
  if (falsy.has(key)) return false
  return undefined
}

// ---------------------------------------------------------------------------
// 终局与排名
// ---------------------------------------------------------------------------

function toMatchResult(state: AvalonEngineState): MatchResult {
  const outcome = state.outcome ?? { winner: 'tie' as const, basis: 'unknown' }
  const factionRank = (player: AvalonEngineState['players'][number]): number => {
    if (outcome.winner === 'tie') return 0
    return factionOf(player.role) === outcome.winner ? 0 : 1
  }
  const ranking = [...state.players]
    .sort((a, b) => {
      const diff = factionRank(a) - factionRank(b)
      if (diff !== 0) return diff
      return a.seat - b.seat
    })
    .map((player, index) => ({
      agentId: player.playerId,
      rank: index + 1,
      score: factionRank(player) === 0 ? 1 : 0,
      extra: { role: player.role, faction: factionOf(player.role) },
    }))
  return {
    winnerFaction: outcome.winner,
    ranking,
    stats: { basis: outcome.basis, successes: successCount(state), fails: failCount(state), rounds: state.round },
  }
}

// ---------------------------------------------------------------------------
// 插件面实现
// ---------------------------------------------------------------------------

export const avalonPluginV2: GameModuleV2<AvalonEngineState, AvalonAction> = {
  gameType,

  createMatch(config, agentIds, seed) {
    void config // 冒烟板无配置面（固定 5 人板，boardId 唯一）
    if (agentIds.length !== AVALON_BOARD_SEATS) {
      return {
        ok: false,
        rejection: {
          code: 'INVALID_BOARD',
          message: `avalon smoke board requires exactly ${AVALON_BOARD_SEATS} player agents, got ${agentIds.length}`,
        },
      }
    }
    const created = engineCreateMatch({
      playerIds: [...agentIds],
      seed: seedFromString(seed ?? `${gameType}:${agentIds.join(',')}`),
    })
    if (created.status !== 'created') {
      return {
        ok: false,
        rejection: {
          code: 'INVALID_BOARD',
          message: created.issues.map((issue) => `${issue.field}: ${issue.message}`).join('; '),
          detail: { issues: created.issues },
        },
      }
    }
    return { ok: true, state: created.state, events: created.events.map(toV2Event) }
  },

  classify(state) {
    if (state.phase === 'ended' || state.outcome !== null) {
      return { kind: 'finished', result: toMatchResult(state) }
    }
    if (state.pendingActor === null) {
      // 引擎保证非终局必有 pendingActor；防御性兜底按战绩裁。
      const successes = successCount(state)
      const fails = failCount(state)
      const winner = successes > fails ? 'good' : fails > successes ? 'evil' : 'tie'
      return {
        kind: 'finished',
        result: toMatchResult({
          ...state,
          outcome: { winner, basis: `classified-fallback:quests-${successes}-${fails}` },
        }),
      }
    }
    return { kind: 'awaiting-action', actorAgentId: state.pendingActor }
  },

  legalActions(state, actorAgentId) {
    return availableActions(state, actorAgentId).map(toActionSpec)
  },

  decisionContext(state, actorAgentId) {
    const actor = state.players.find((player) => player.playerId === actorAgentId) ?? null
    const leader = state.players.find((player) => player.seat === state.leaderSeat) ?? null
    return {
      round: state.round,
      attempt: state.attempt,
      phase: state.phase,
      yourSeat: actor?.seat ?? null,
      yourRole: actor?.role ?? null,
      yourFaction: actor ? factionOf(actor.role) : null,
      leaderId: leader?.playerId ?? null,
      proposal: state.proposal
        ? { round: state.proposal.round, attempt: state.proposal.attempt, leaderId: state.proposal.leaderId, teamIds: [...state.proposal.teamIds] }
        : null,
      votesCast: state.voteRound ? state.voteRound.cast.length : 0,
      votersTotal: state.voteRound ? state.voteRound.cast.length + state.voteRound.queue.length : 0,
      questTeamIds: state.quest ? [...state.quest.teamIds] : [],
      questChoicesMade: state.quest ? state.quest.choices.length : 0,
      scoreboard: {
        successes: successCount(state),
        fails: failCount(state),
        results: state.results.map((result) => ({
          round: result.round,
          outcome: result.outcome,
          failVotes: result.failVotes,
          autoFailed: result.autoFailed,
        })),
      },
      board: { seats: AVALON_BOARD_SEATS, teamSize: 2, questCount: 3, maxRejections: 3 },
    }
  },

  normalizeAction(raw, state, actorAgentId): V2NormalizeResult<AvalonAction> {
    const record = asRecord(raw)
    const rawType = typeof record.type === 'string' ? record.type : null
    if (!rawType) {
      return { ok: false, rejection: { code: 'UNPARSEABLE', message: '动作缺少字符串 type 字段' } }
    }
    const legalTypes = new Set(availableActions(state, actorAgentId).map((option) => option.type))
    const candidates = [rawType as AvalonActionType, ...TYPE_ALIASES[shapeKey(rawType)]]
    const resolved = candidates.find((candidate) => legalTypes.has(candidate))
    if (!resolved) {
      return {
        ok: false,
        rejection: {
          code: 'UNPARSEABLE',
          message: `动作类型 "${rawType}" 无法归一到当前合法动作（${[...legalTypes].join('、') || '无'}）`,
        },
      }
    }

    const candidate: Record<string, unknown> = { type: resolved, actorId: actorAgentId }
    if (resolved === 'proposeTeam') {
      const targets = Array.isArray(record.targetIds)
        ? record.targetIds
        : Array.isArray(record.teamIds)
          ? record.teamIds
          : Array.isArray(record.players)
            ? record.players
            : typeof record.targetId === 'string'
              ? [record.targetId]
              : []
      const ids = targets.filter((target): target is string => typeof target === 'string')
      candidate.targetIds = ids
    } else if (resolved === 'vote') {
      const approve =
        boolFromWords(record.approve, APPROVE_WORDS, REJECT_WORDS) ??
        boolFromWords(record.choice, APPROVE_WORDS, REJECT_WORDS) ??
        boolFromWords(record.targetId, APPROVE_WORDS, REJECT_WORDS) ??
        boolFromWords(record.vote, APPROVE_WORDS, REJECT_WORDS)
      if (approve === undefined) {
        return { ok: false, rejection: { code: 'UNPARSEABLE', message: 'vote 动作缺少 approve/choice（approve|reject）' } }
      }
      candidate.approve = approve
    } else {
      const succeed =
        boolFromWords(record.succeed, SUCCESS_WORDS, FAIL_WORDS) ??
        boolFromWords(record.choice, SUCCESS_WORDS, FAIL_WORDS) ??
        boolFromWords(record.targetId, SUCCESS_WORDS, FAIL_WORDS)
      if (succeed === undefined) {
        return { ok: false, rejection: { code: 'UNPARSEABLE', message: 'quest 动作缺少 succeed/choice（success|fail）' } }
      }
      candidate.succeed = succeed
    }

    const normalized = engineNormalizeAction(candidate)
    if (!normalized.ok) {
      return { ok: false, rejection: { code: normalized.rejection.code, message: normalized.rejection.message } }
    }
    return { ok: true, action: normalized.action }
  },

  applyAction(state, _actorAgentId, action) {
    const outcome = engineApplyAction(state, action)
    if (outcome.status !== 'accepted') {
      return { ok: false, rejection: { code: outcome.rejection.code, message: outcome.rejection.message } }
    }
    return { ok: true, state: outcome.state, events: outcome.events.map(toV2Event) }
  },

  applyDefaultAction(state) {
    const outcome = engineApplyDefault(state)
    if (outcome.status !== 'accepted') {
      return { ok: false, rejection: { code: outcome.rejection.code, message: outcome.rejection.message } }
    }
    return { ok: true, state: outcome.state, events: outcome.events.map(toV2Event) }
  },

  requestStopAfterCurrentHand(state) {
    // 阿瓦隆无「手」概念：返回原 state，无事件
    return { state, events: [] }
  },

  terminateImmediately(state) {
    const outcome = engineTerminate(state)
    if (outcome.status !== 'accepted') {
      return { ok: false, rejection: { code: outcome.rejection.code, message: outcome.rejection.message } }
    }
    return { ok: true, state: outcome.state, events: outcome.events.map(toV2Event) }
  },

  onEventsBatch() {
    // 阿瓦隆无需游戏专属批处理钩子（spec §2：仅德扑有印象信号）
  },

  visibleEventsFor(fullStream, agentId) {
    const events = fullStream.filter(isAvalonEventPayload)
    return engineVisibleEvents(events, { type: 'player', playerId: agentId }).map((event) => ({ ...event }))
  },

  reserveEventSeq(state) {
    const seq = state.nextSeq
    return { state: { ...state, nextSeq: state.nextSeq + 1 }, seq }
  },

  stateSummary(state) {
    return { handNumber: 0, day: state.round, phase: state.phase }
  },

  gameInfo(state) {
    void state
    return {
      gameType,
      board: 'smoke-5',
      seats: AVALON_BOARD_SEATS,
      roles: '梅林、派西维尔、忠诚仆从、莫德雷德、爪牙各 1',
      teamSize: 2,
      questCount: 3,
      maxRejections: 3,
      winCondition: '好人 2 任务成功 / 坏人 2 任务失败（3 轮内先到 2 者胜）',
    }
  },

  presentation: avalonPresentation,
}

function toActionSpec(option: ActionOption): V2ActionSpec {
  return {
    type: option.type,
    label: option.label,
    targetIds: [...option.targetIds],
    allowNone: option.allowNone,
  }
}
