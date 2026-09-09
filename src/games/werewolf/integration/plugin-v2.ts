/**
 * 狼人杀 engine2 平台插件（spec: docs/specs/engine2-integration.md §2）。
 *
 * 纯函数包装 `src/games/werewolf/engine2`：无 IO。跨游戏差异（板子预设、
 * LLM 别名容错、强制终局语义）全部收敛于此，GM 无 gameType 分支。
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
  BOARD_PRESET_6P_BASE,
  BOARD_PRESET_9P_333,
  alivePlayers,
  aliveWolves,
  applyAction as engineApplyAction,
  applyDefaultAction as engineApplyDefault,
  availableActions,
  createMatch as engineCreateMatch,
  evaluateWin,
  factionOf,
  makeEvent,
  normalizeAction as engineNormalizeAction,
  presetBoard,
  visibleEvents as engineVisibleEvents,
} from '../engine2'
import type {
  ActionOption,
  BoardPreset,
  WerewolfAction,
  WerewolfActionType,
  WerewolfEngineState,
  WerewolfEvent,
} from '../engine2'
import { werewolfPresentation } from './presentation-v2'

// FR-4.7-01 / R3-3：主持人旁白触发判定（纯函数）经插件文件再导出以便发现；
// platform 契约（GameModuleV2）不新增成员，backend/match/narration.ts 按
// gameType 直接装配（与 v2-agent-branch 同模式）。
export {
  werewolfNarrationTrigger,
  type WerewolfNarrationTrigger,
} from './narration'

const gameType: GameType = 'werewolf'

export const WEREWOLF_BOARD_IDS = ['base-6', '333-9'] as const
export type WerewolfBoardId = (typeof WEREWOLF_BOARD_IDS)[number]

function presetFor(boardId: string): BoardPreset | null {
  if (boardId === 'base-6') return BOARD_PRESET_6P_BASE
  if (boardId === '333-9') return BOARD_PRESET_9P_333
  return null
}

/** FNV-1a 32 位字符串哈希（种子字符串 → 引擎数值种子；不得跨游戏复用德扑实现）。 */
function seedFromString(seed: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    h = (h ^ seed.charCodeAt(i)) >>> 0
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

// ---------------------------------------------------------------------------
// 事件信封：WerewolfEvent → V2Event
// ---------------------------------------------------------------------------

function toAudience(event: WerewolfEvent): V2Audience {
  const audience = event.audience
  switch (audience.kind) {
    case 'public':
      return { kind: 'public' }
    case 'wolves':
      return { kind: 'wolves' }
    case 'moderator':
      return { kind: 'moderator' }
    case 'sheriff':
      return { kind: 'sheriff' }
    case 'role-self':
      return { kind: 'self', scope: 'role-self', agentId: audience.playerId }
  }
}

function toV2Event(event: WerewolfEvent): V2Event {
  return {
    kind: event.kind,
    seq: event.seq,
    actorAgentId: event.actorId,
    isDefault: event.isDefault === true,
    audience: toAudience(event),
    raw: { ...event },
  }
}

function isWerewolfEventPayload(value: unknown): value is WerewolfEvent {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<WerewolfEvent>
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
// LLM 别名容错（WFR-303 上游适配边界）
// ---------------------------------------------------------------------------

/** 归一化 type → 候选标准动作类型（语境消歧由 availableActions 交集完成）。 */
const TYPE_ALIASES: Record<string, WerewolfActionType[]> = {
  kill: ['kill'],
  werewolfkill: ['kill'],
  wolfkill: ['kill'],
  murder: ['kill'],
  刀: ['kill'],
  自爆: ['kill'],
  seercheck: ['seerCheck'],
  check: ['seerCheck'],
  verify: ['seerCheck'],
  查验: ['seerCheck'],
  验人: ['seerCheck'],
  witchsave: ['witchSave'],
  save: ['witchSave'],
  heal: ['witchSave'],
  rescue: ['witchSave'],
  救: ['witchSave'],
  解药: ['witchSave'],
  witchpoison: ['witchPoison'],
  poison: ['witchPoison'],
  毒: ['witchPoison'],
  毒药: ['witchPoison'],
  speak: ['speak'],
  say: ['speak'],
  talk: ['speak'],
  claim: ['speak'],
  发言: ['speak'],
  vote: ['vote'],
  投票: ['vote'],
  lastwords: ['lastWords'],
  遗言: ['lastWords'],
  huntershoot: ['hunterShoot'],
  shoot: ['hunterShoot'],
  开枪: ['hunterShoot'],
  hunterpass: ['hunterPass'],
  憋枪: ['hunterPass'],
  // pass/skip 语义随阶段变化：由合法动作集消歧（WFR-304 各槽位的显式 pass 变体）
  skip: ['lastWordsPass', 'hunterPass', 'witchPoisonPass', 'witchSavePass', 'seerPass'],
  pass: ['lastWordsPass', 'hunterPass', 'witchPoisonPass', 'witchSavePass', 'seerPass'],
  abstain: ['vote'],
  弃票: ['vote'],
  跳过: ['lastWordsPass', 'hunterPass', 'witchPoisonPass', 'witchSavePass', 'seerPass'],
}

function shapeKey(rawType: string): string {
  return rawType.replace(/^(night|day)[/_-]/i, '').replace(/[/_-]/g, '').toLowerCase()
}

function candidatesFor(rawType: string): WerewolfActionType[] {
  const key = shapeKey(rawType)
  return TYPE_ALIASES[key] ?? TYPE_ALIASES[rawType] ?? []
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function clampText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  return value.slice(0, max)
}

// ---------------------------------------------------------------------------
// 终局与排名
// ---------------------------------------------------------------------------

function toMatchResult(state: WerewolfEngineState): MatchResult {
  const outcome = state.outcome ?? { winner: 'tie' as const, basis: 'unknown' }
  const factionRank = (player: WerewolfEngineState['players'][number]): number => {
    if (outcome.winner === 'tie') return 0
    return factionOf(player.role) === outcome.winner ? 0 : 1
  }
  const ranking = [...state.players]
    .sort((a, b) => {
      const diff = factionRank(a) - factionRank(b)
      if (diff !== 0) return diff
      const aliveDiff = (a.alive ? 0 : 1) - (b.alive ? 0 : 1)
      if (aliveDiff !== 0) return aliveDiff
      return a.seat - b.seat
    })
    .map((player, index) => ({
      agentId: player.playerId,
      rank: index + 1,
      score: factionRank(player) === 0 ? 1 : 0,
      extra: {
        role: player.role,
        alive: player.alive,
        deathCauses: player.death ? [...player.death.causes] : null,
        deathDay: player.death?.settledDay ?? null,
      },
    }))
  return {
    winnerFaction: outcome.winner,
    ranking,
    stats: { basis: outcome.basis, totalDays: state.day },
  }
}

function fallbackOutcome(state: WerewolfEngineState): { winner: 'wolves' | 'good' | 'tie'; basis: string } {
  const wolves = aliveWolves(state).length
  const good = alivePlayers(state).length - wolves
  if (wolves > good) return { winner: 'wolves', basis: 'terminated-immediate:alive-majority' }
  if (good > wolves) return { winner: 'good', basis: 'terminated-immediate:alive-majority' }
  return { winner: 'tie', basis: 'terminated-immediate:alive-equal' }
}

/** evaluateWin 的存活快照（engine2 barrel 未导出 aliveForWin，此处内联）。 */
function aliveSnapshot(state: WerewolfEngineState): Array<{ playerId: string; role: WerewolfEngineState['players'][number]['role'] }> {
  return state.players.filter((player) => player.alive).map((player) => ({ playerId: player.playerId, role: player.role }))
}

// ---------------------------------------------------------------------------
// 插件面实现
// ---------------------------------------------------------------------------

export const werewolfPluginV2: GameModuleV2<WerewolfEngineState, WerewolfAction> = {
  gameType,

  createMatch(config, agentIds, seed) {
    const raw = asRecord(config)
    const boardId = typeof raw.boardId === 'string' ? raw.boardId : 'base-6'
    const preset = presetFor(boardId)
    if (!preset) {
      return {
        ok: false,
        rejection: { code: 'INVALID_BOARD', message: `未知板子 boardId: ${boardId}（可用：${WEREWOLF_BOARD_IDS.join(', ')}）` },
      }
    }
    const overrides = raw.board !== undefined && typeof raw.board === 'object' && raw.board !== null
      ? (raw.board as Partial<BoardPreset>)
      : {}
    const parsed = presetBoard(preset, overrides)
    if (!parsed.ok) {
      return {
        ok: false,
        rejection: {
          code: 'INVALID_BOARD',
          message: parsed.issues.map((issue) => `${issue.field}: ${issue.message}`).join('; '),
          detail: { issues: parsed.issues },
        },
      }
    }
    const created = engineCreateMatch({
      board: parsed.board,
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
      return { kind: 'finished', result: toMatchResult({ ...state, outcome: fallbackOutcome(state) }) }
    }
    return { kind: 'awaiting-action', actorAgentId: state.pendingActor }
  },

  legalActions(state, actorAgentId) {
    return availableActions(state, actorAgentId).map(toActionSpec)
  },

  decisionContext(state, actorAgentId) {
    const actor = state.players.find((player) => player.playerId === actorAgentId) ?? null
    const alive = alivePlayers(state)
      .slice()
      .sort((a, b) => a.seat - b.seat)
      .map((player) => ({ playerId: player.playerId, seat: player.seat }))
    const dead = state.players
      .filter((player) => !player.alive)
      .map((player) => ({
        playerId: player.playerId,
        seat: player.seat,
        deathDay: player.death?.settledDay ?? null,
        deathCauses: player.death ? [...player.death.causes] : [],
      }))
    return {
      day: state.day,
      phase: state.phase,
      nightNumber: state.night?.nightNumber ?? null,
      yourSeat: actor?.seat ?? null,
      yourRole: actor?.role ?? null,
      alivePlayers: alive,
      deadPlayers: dead,
      witchPotions: actor?.role === 'witch' ? { ...state.witchPotions } : null,
      speechTurn: state.speechTurn,
      remainingSpeakers: [...state.speechQueue],
      voteRound: state.voteRound
        ? {
            round: state.voteRound.round,
            candidates: state.voteRound.candidates,
            votesCast: state.voteRound.votes.length,
          }
        : null,
      board: {
        voteRule: state.board.voteRule,
        voteTiePolicy: state.board.voteTiePolicy,
        winCondition: state.board.winCondition,
        speechMaxLength: state.board.speechMaxLength,
        lastWordsMaxLength: state.board.lastWordsMaxLength,
        emptyKillAllowed: state.board.emptyKillAllowed,
        selfKillAllowed: state.board.selfKillAllowed,
        maxDays: state.board.maxDays,
      },
    }
  },

  normalizeAction(raw, state, actorAgentId): V2NormalizeResult<WerewolfAction> {
    const record = asRecord(raw)
    const rawType = typeof record.type === 'string' ? record.type : null
    if (!rawType) {
      return { ok: false, rejection: { code: 'UNPARSEABLE', message: '动作缺少字符串 type 字段' } }
    }
    const legalTypes = new Set(availableActions(state, actorAgentId).map((option) => option.type))
    const candidates = [rawType as WerewolfActionType, ...candidatesFor(rawType)]
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
    const targetId =
      record.targetId === null || typeof record.targetId === 'string' ? (record.targetId as string | null) : undefined
    const content =
      resolved === 'speak'
        ? clampText(record.content, state.board.speechMaxLength)
        : resolved === 'lastWords'
          ? clampText(record.content, state.board.lastWordsMaxLength)
          : undefined
    const candidate: Record<string, unknown> = { type: resolved, actorId: actorAgentId }
    // vote / kill 允许 null 目标（弃票 / 空刀）：LLM 省略 targetId 时按 null 处理
    if (targetId !== undefined || resolved === 'vote' || resolved === 'kill') {
      candidate.targetId = targetId ?? null
    }
    if (content !== undefined) candidate.content = content

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
    // 狼人杀无「手」概念（spec §2）：返回原 state，无事件
    return { state, events: [] }
  },

  terminateImmediately(state) {
    if (state.phase === 'ended' || state.outcome !== null) {
      return { ok: false, rejection: { code: 'MATCH_ALREADY_FINISHED', message: '对局已终局' } }
    }
    const next = structuredClone(state)
    const evaluation = evaluateWin(aliveSnapshot(next), {
      winCondition: next.board.winCondition,
      wolfPriority: next.board.wolfPriorityOnSimultaneousWin,
    })
    const outcome = evaluation.settled
      ? { winner: evaluation.winner, basis: evaluation.basis }
      : fallbackOutcome(next)
    next.outcome = outcome
    next.pendingActor = null
    next.voteRound = null
    next.phase = 'ended'
    const event = makeEvent({
      seq: next.nextSeq++,
      day: next.day,
      kind: 'gameEnded',
      audience: { kind: 'public' },
      actorId: null,
      payload: {
        winner: outcome.winner,
        basis: outcome.basis,
        reveal: next.players.map((player) => ({
          playerId: player.playerId,
          seat: player.seat,
          role: player.role,
          death: player.death ? { ...player.death, causes: [...player.death.causes] } : null,
        })),
      },
    })
    return { ok: true, state: next, events: [toV2Event(event)] }
  },

  onEventsBatch() {
    // 狼人杀无需游戏专属批处理钩子（spec §2：仅德扑有印象信号）
  },

  visibleEventsFor(fullStream, agentId) {
    const events = fullStream.filter(isWerewolfEventPayload)
    return engineVisibleEvents(events, { type: 'player', playerId: agentId }).map((event) => ({ ...event }))
  },

  reserveEventSeq(state) {
    const seq = state.nextSeq
    return { state: { ...state, nextSeq: state.nextSeq + 1 }, seq }
  },

  stateSummary(state) {
    return { handNumber: 0, day: state.day, phase: state.phase }
  },

  gameInfo(state) {
    const roles = Object.entries(state.board.roles)
      .filter(([, count]) => count > 0)
      .map(([role, count]) => `${role}×${count}`)
      .join('、')
    return {
      gameType,
      seats: state.players.length,
      roles,
      winCondition: state.board.winCondition,
      voteRule: state.board.voteRule,
      maxDays: state.board.maxDays,
      speechMaxLength: state.board.speechMaxLength,
      lastWordsMaxLength: state.board.lastWordsMaxLength,
    }
  },

  presentation: werewolfPresentation,
}

function toActionSpec(option: ActionOption): V2ActionSpec {
  return {
    type: option.type,
    label: option.label,
    targetIds: [...option.targetIds],
    allowNone: option.allowNone,
  }
}
