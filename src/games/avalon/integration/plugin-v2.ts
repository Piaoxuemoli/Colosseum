/**
 * 阿瓦隆 engine2 平台插件（spec: docs/specs/engine2-integration.md §2）。
 *
 * 全量规则接入点（PRD docs/prd/games/avalon-engine.md）：纯函数包装
 * `src/games/avalon/engine2`，无 IO。跨游戏差异（板子预设、LLM 别名容错、
 * 强制终局语义、AVR-202 机械量投影）全部收敛于此，GM 无 gameType 分支——
 * 平台核心零改动即可驱动本品类（NFR-08 / AVR-N3）。
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
  AVALON_PRESET_IDS,
  MAX_REJECTIONS,
  QUEST_COUNT,
  WINS_REQUIRED,
  applyAction as engineApplyAction,
  applyDefaultAction as engineApplyDefault,
  availableActions,
  createMatch as engineCreateMatch,
  failCount,
  factionOf,
  normalizeAction as engineNormalizeAction,
  requiredFailsOf,
  resolveBoard,
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

// FR-4.7-01 / AVR-OD-6：主持人旁白触发判定（纯函数）经插件文件再导出以便发现；
// platform 契约（GameModuleV2）不新增成员，backend/match/narration.ts 按
// gameType 条目注册（与狼人杀同模式）。
export { avalonNarrationTrigger, type AvalonNarrationTrigger } from './narration'

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
// LLM 别名容错（AVR-303 上游适配边界：语境消歧由 availableActions 交集完成）
// ---------------------------------------------------------------------------

const TYPE_ALIASES: Record<string, AvalonActionType[]> = {
  speak: ['speak'],
  speech: ['speak'],
  say: ['speak'],
  talk: ['speak'],
  statement: ['speak'],
  发言: ['speak'],
  说: ['speak'],
  讲话: ['speak'],
  声明: ['speak'],
  陈述: ['speak'],
  讨论: ['speak'],
  proposeteam: ['proposeTeam'],
  propose: ['proposeTeam'],
  team: ['proposeTeam'],
  nominate: ['proposeTeam'],
  nominateteam: ['proposeTeam'],
  提名: ['proposeTeam'],
  提案: ['proposeTeam'],
  组队: ['proposeTeam'],
  vote: ['vote'],
  teamvote: ['vote'],
  voteteam: ['vote'],
  ballot: ['vote'],
  表决: ['vote'],
  投票: ['vote'],
  quest: ['quest'],
  choose: ['quest'],
  questchoice: ['quest'],
  mission: ['quest'],
  任务: ['quest'],
  出牌: ['quest'],
  抉择: ['quest'],
  consult: ['consult'],
  whisper: ['consult'],
  evilconsult: ['consult'],
  evilspeak: ['consult'],
  合议: ['consult'],
  密谋: ['consult'],
  私语: ['consult'],
  商议: ['consult'],
  assassinate: ['assassinate'],
  kill: ['assassinate'],
  stab: ['assassinate'],
  assassin: ['assassinate'],
  指认: ['assassinate'],
  刺杀: ['assassinate'],
  暗杀: ['assassinate'],
}

const APPROVE_WORDS = new Set(['approve', 'yes', 'for', 'true', '赞同', '赞成', '同意', '通过', '支持'])
const REJECT_WORDS = new Set(['reject', 'no', 'against', 'false', '反对', '否决', '否', '不支持'])
const SUCCESS_WORDS = new Set(['success', 'succeed', 'win', 'true', '成功', '使成功'])
const FAIL_WORDS = new Set(['fail', 'failure', 'sabotage', 'false', '失败', '破坏', '使失败'])

function shapeKey(rawType: string): string {
  return rawType.replace(/[/_-]/g, '').toLowerCase()
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function boolFromWords(value: unknown, truthy: ReadonlySet<string>, falsy: ReadonlySet<string>): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return undefined
  const key = value.trim().toLowerCase()
  if (truthy.has(key)) return true
  if (falsy.has(key)) return false
  return undefined
}

function textOf(record: Record<string, unknown>): string | undefined {
  for (const key of ['text', 'content', 'message', 'speech', 'statement']) {
    if (typeof record[key] === 'string') return record[key] as string
  }
  return undefined
}

function targetListOf(record: Record<string, unknown>): string[] | undefined {
  for (const key of ['targetIds', 'teamIds', 'players', 'team', 'targets']) {
    const value = record[key]
    if (Array.isArray(value)) {
      const ids = value.filter((entry): entry is string => typeof entry === 'string')
      if (ids.length > 0) return ids
    }
  }
  const single = targetSingleOf(record)
  return single === null ? undefined : [single]
}

function targetSingleOf(record: Record<string, unknown>): string | null {
  for (const key of ['targetId', 'victim', 'target', 'playerId']) {
    if (typeof record[key] === 'string') return record[key] as string
  }
  return null
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
    stats: {
      basis: outcome.basis,
      successes: successCount(state),
      fails: failCount(state),
      rounds: state.round,
      ...(state.assassination ? { assassination: { ...state.assassination } } : {}),
    },
  }
}

// ---------------------------------------------------------------------------
// 插件面实现
// ---------------------------------------------------------------------------

export const avalonPluginV2: GameModuleV2<AvalonEngineState, AvalonAction> = {
  gameType,

  createMatch(config, agentIds, seed) {
    const raw = asRecord(config)
    const preset = typeof raw.preset === 'string' ? raw.preset : 'basic-5'
    const resolved = resolveBoard({
      preset,
      ...(typeof raw.discussionEnabled === 'boolean' ? { discussionEnabled: raw.discussionEnabled } : {}),
    })
    if (!resolved.ok) {
      return {
        ok: false,
        rejection: {
          code: 'INVALID_BOARD',
          message: resolved.issues.map((issue) => `${issue.field}: ${issue.message}`).join('; '),
          detail: { issues: resolved.issues },
        },
      }
    }
    const seats = Object.values(resolved.board.roles).reduce((sum, count) => sum + count, 0)
    if (agentIds.length !== seats) {
      return {
        ok: false,
        rejection: {
          code: 'INVALID_BOARD',
          message: `avalon board "${preset}" requires exactly ${seats} player agents, got ${agentIds.length}`,
        },
      }
    }
    const created = engineCreateMatch({
      board: resolved.board,
      playerIds: [...agentIds],
      seed: seedFromString(seed ?? `${gameType}:${preset}:${agentIds.join(',')}`),
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
    const actorIsEvil = actor ? factionOf(actor.role) === 'evil' : false
    const round = state.round
    const teamSize = state.board.teamSizes[round - 1] ?? null
    const requiredFails = round >= 1 ? requiredFailsOf(state.board, round) : null
    return {
      round,
      attempt: state.attempt,
      phase: state.phase,
      pendingActorId: state.pendingActor,
      yourSeat: actor?.seat ?? null,
      yourRole: actor?.role ?? null,
      yourFaction: actor ? factionOf(actor.role) : null,
      leaderId: leader?.playerId ?? null,
      // 本轮结构参数 + 双失败轮提示（AVR-402）+ 连坐余量（AVR-403）。
      teamSize,
      requiredFails,
      isDoubleFailRound: requiredFails === 2,
      rejectionsRemaining: MAX_REJECTIONS - state.attempt,
      scoreboard: {
        successes: successCount(state),
        fails: failCount(state),
        results: state.results.map((result) => ({
          round: result.round,
          outcome: result.outcome,
          failVotes: result.failVotes,
          requiredFails: result.requiredFails,
        })),
      },
      proposal: state.proposal
        ? {
            round: state.proposal.round,
            attempt: state.proposal.attempt,
            leaderId: state.proposal.leaderId,
            teamIds: [...state.proposal.teamIds],
          }
        : null,
      // 公开记名（AVR-107）：已投立场与待投人都是公开事实。
      currentVotes: state.voteRound
        ? { cast: [...state.voteRound.cast], pendingVoterId: state.voteRound.queue[0] ?? null }
        : null,
      quest: state.quest ? { teamIds: [...state.quest.teamIds], choicesMade: state.quest.choices.length } : null,
      discussionQueue: state.discussion ? [...state.discussion.queue] : null,
      // 合议队列仅对坏人可见（队列成员本身即坏人身份情报，AVR-204）。
      consultationQueue: actorIsEvil && state.consultation ? [...state.consultation.queue] : null,
      // 该玩家已收到的夜间情报（AVR-203；只含本人受众事件的信息）。
      knowledge: state.knowledge
        .filter((record) => record.playerId === actorAgentId)
        .map((record) => ({ insight: record.insight, playerIds: [...record.playerIds] })),
      // 公开投票史 + 发言史摘要（全文由 visibleEvents 事件流承担）。
      voteHistory: state.voteHistory.map((entry) => ({
        round: entry.round,
        attempt: entry.attempt,
        cast: [...entry.cast],
      })),
      statements: {
        recent: state.statementLog.slice(-10),
        total: state.statementLog.length,
      },
      assassination: state.assassination ? { ...state.assassination } : null,
      board: {
        boardId: state.board.id,
        boardName: state.board.name,
        seats: state.players.length,
        teamSizes: [...state.board.teamSizes],
        doubleFailRounds: [...state.board.doubleFailRounds],
        discussionEnabled: state.board.discussionEnabled,
        questCount: QUEST_COUNT,
        winsRequired: WINS_REQUIRED,
        maxRejections: MAX_REJECTIONS,
      },
    }
  },

  normalizeAction(raw, state, actorAgentId): V2NormalizeResult<AvalonAction> {
    const record = asRecord(raw)
    const rawType = typeof record.type === 'string' ? record.type : null
    if (!rawType) {
      return { ok: false, rejection: { code: 'UNPARSEABLE', message: '动作缺少字符串 type 字段' } }
    }
    const legalTypes = new Set(availableActions(state, actorAgentId).map((option) => option.type))
    const candidates = [rawType as AvalonActionType, ...(TYPE_ALIASES[shapeKey(rawType)] ?? [])]
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
    if (resolved === 'speak' || resolved === 'consult') {
      // 文本长度口径（1–2000）交给引擎 validateAction：越域 → ILLEGAL_CHOICE。
      const text = textOf(record)
      if (text === undefined) {
        return { ok: false, rejection: { code: 'UNPARSEABLE', message: `${resolved} 动作缺少 text/content 文本字段` } }
      }
      candidate.text = text
    } else if (resolved === 'proposeTeam') {
      const ids = targetListOf(record)
      if (ids === undefined) {
        return { ok: false, rejection: { code: 'UNPARSEABLE', message: 'proposeTeam 动作缺少 targetIds/teamIds 名单字段' } }
      }
      candidate.targetIds = ids
    } else if (resolved === 'vote') {
      const approve =
        boolFromWords(record.approve, APPROVE_WORDS, REJECT_WORDS) ??
        boolFromWords(record.choice, APPROVE_WORDS, REJECT_WORDS) ??
        boolFromWords(record.vote, APPROVE_WORDS, REJECT_WORDS) ??
        boolFromWords(record.targetId, APPROVE_WORDS, REJECT_WORDS)
      if (approve === undefined) {
        return { ok: false, rejection: { code: 'UNPARSEABLE', message: 'vote 动作缺少 approve/choice（approve|reject）' } }
      }
      candidate.approve = approve
    } else if (resolved === 'quest') {
      const succeed =
        boolFromWords(record.succeed, SUCCESS_WORDS, FAIL_WORDS) ??
        boolFromWords(record.choice, SUCCESS_WORDS, FAIL_WORDS) ??
        boolFromWords(record.targetId, SUCCESS_WORDS, FAIL_WORDS)
      if (succeed === undefined) {
        return { ok: false, rejection: { code: 'UNPARSEABLE', message: 'quest 动作缺少 succeed/choice（success|fail）' } }
      }
      candidate.succeed = succeed
    } else {
      const targetId = targetSingleOf(record)
      if (targetId === null) {
        return { ok: false, rejection: { code: 'UNPARSEABLE', message: 'assassinate 动作缺少 targetId 指认目标' } }
      }
      candidate.targetId = targetId
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
    // 阿瓦隆无「手」概念（spec §2）：返回原 state，无事件
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
    const roles = Object.entries(state.board.roles)
      .filter(([, count]) => count > 0)
      .map(([role, count]) => `${role}×${count}`)
      .join('、')
    return {
      gameType,
      board: state.board.id,
      boardName: state.board.name,
      seats: state.players.length,
      roles,
      teamSizes: [...state.board.teamSizes],
      doubleFailRounds: [...state.board.doubleFailRounds],
      discussionEnabled: state.board.discussionEnabled,
      questCount: QUEST_COUNT,
      winsRequired: WINS_REQUIRED,
      maxRejections: MAX_REJECTIONS,
      winCondition: '好人 3 任务成功（随后经受刺杀考验）/ 坏人 3 任务失败或第 5 次提案被拒连坐',
      presets: [...AVALON_PRESET_IDS],
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
