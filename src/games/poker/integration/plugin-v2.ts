/**
 * 德扑 engine2 平台插件（spec: docs/specs/engine2-integration.md §2）。
 *
 * 纯函数包装 `src/games/poker/engine2`：无 IO、无时间、无第二随机源。
 * 游戏专属逻辑（配置映射 / LLM 别名容错 / 印象信号）全部收敛于此，
 * GM 通过 GameModuleV2 面驱动，不出现任何 gameType 分支。
 */

import type { GameType, MatchResult } from '@/platform/core/types'
import type {
  GameModuleV2,
  V2ActionSpec,
  V2ApplyResult,
  V2Audience,
  V2Event,
  V2Impressions,
  V2ImpressionsMemoryPort,
  V2ImpressionsSignal,
  V2NormalizeResult,
  V2Rejection,
} from '@/platform/engine/contracts-v2'
import {
  cardCode,
  classifyState,
  createMatch as engineCreateMatch,
  decisionContext as engineDecisionContext,
  filterEvents,
  legalActionSet,
  requestStopAfterCurrentHand as engineRequestStop,
  terminateImmediately as engineTerminate,
  validateAction,
  applyAction as engineApplyAction,
} from '../engine2'
import type {
  ActionRejection,
  BlindSchedule,
  LegalAction,
  MatchState,
  PlayerAction,
  PokerEvent,
} from '../engine2'
import { PokerMemoryModule } from '../memory/poker-memory'
import type { PokerWorkingMemory } from '../memory/working'
import { generateImpressionParagraph } from '../memory/summary'
import type { PokerEpisodicEntry } from '../memory/episodic'
import type { PokerSemanticProfile } from '../memory/semantic'
import { pokerPresentation } from './presentation-v2'

const gameType: GameType = 'poker'

/** 旧 engineConfig 键 → engine2 配置（默认值沿用 v1 默认：盲注 2/4、起始 200）。 */
const DEFAULT_SMALL_BLIND = 2
const DEFAULT_BIG_BLIND = 4
const DEFAULT_STARTING_STACK = 200

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function positiveInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null
}

function toBlindSchedule(value: unknown): BlindSchedule | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const schedule = value as BlindSchedule
  if (
    typeof schedule.handsPerLevel === 'number' &&
    Array.isArray(schedule.levels) &&
    schedule.levels.length > 0
  ) {
    return schedule
  }
  return undefined
}

/** config（legacy engineConfig 或 engine2 原生形状）→ engine2 matchConfig 输入。 */
function mapEngineConfig(config: unknown): Record<string, unknown> {
  const raw = asRecord(config)
  const native = asRecord(raw.config)
  if (native.seatIds !== undefined || raw.seatIds !== undefined) {
    // engine2 原生形状直接透传
    return native.seatIds !== undefined ? native : raw
  }
  const sb = positiveInt(raw.smallBlind) ?? DEFAULT_SMALL_BLIND
  const bb = positiveInt(raw.bigBlind) ?? DEFAULT_BIG_BLIND
  const startingStack = positiveInt(raw.startingChips) ?? positiveInt(raw.startingStack) ?? DEFAULT_STARTING_STACK
  const schedule = toBlindSchedule(raw.schedule)
  return {
    blinds: { sb, bb },
    startingStack,
    ...(schedule ? { schedule } : {}),
  }
}

// ---------------------------------------------------------------------------
// 事件信封：PokerEvent → V2Event
// ---------------------------------------------------------------------------

function toAudience(event: PokerEvent): V2Audience {
  const audience = event.audience
  if (audience.kind === 'public') return { kind: 'public' }
  if (audience.kind === 'delayed-public') return { kind: 'delayed-public' }
  return { kind: 'self', scope: 'self', agentId: audience.seatId }
}

function toV2Event(event: PokerEvent): V2Event {
  return {
    kind: event.kind,
    seq: event.seq,
    actorAgentId: actorOfPokerEvent(event),
    isDefault: false,
    audience: toAudience(event),
    raw: { ...event },
  }
}

function actorOfPokerEvent(event: PokerEvent): string | null {
  if ('seatId' in event && typeof event.seatId === 'string') return event.seatId
  return null
}

function wrapCreate(state: MatchState, events: PokerEvent[]): { ok: true; state: MatchState; events: V2Event[] } {
  return { ok: true, state, events: events.map(toV2Event) }
}

function wrapApply(
  outcome: { ok: true; state: MatchState; events: PokerEvent[] } | { ok: false; state: MatchState; rejection: ActionRejection },
): V2ApplyResult<MatchState> {
  if (outcome.ok) return wrapCreate(outcome.state, outcome.events)
  return { ok: false, rejection: { code: outcome.rejection.code, message: outcome.rejection.message, detail: { currentActor: outcome.rejection.currentActor } } }
}

// ---------------------------------------------------------------------------
// DB payload（引擎事件 JSON）结构识别
// ---------------------------------------------------------------------------

/** 引擎事件 JSON 与 `Record<string, unknown>` 的交集视图（filter 谓词用）。 */
type PokerEventRecord = PokerEvent & Record<string, unknown>
type ActionMadeRecord = Extract<PokerEvent, { kind: 'action-made' }> & Record<string, unknown>

function isPokerEventPayload(value: unknown): value is PokerEventRecord {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<PokerEvent>
  return (
    typeof candidate.kind === 'string' &&
    typeof candidate.seq === 'number' &&
    typeof candidate.hand === 'number' &&
    typeof candidate.audience === 'object' &&
    candidate.audience !== null &&
    !('payload' in candidate)
  )
}

function isActionMade(value: PokerEventRecord): value is ActionMadeRecord {
  return value.kind === 'action-made'
}

// ---------------------------------------------------------------------------
// LLM 别名容错（引擎 validateAction 之前的纯文本归一）
// ---------------------------------------------------------------------------

const POKER_TYPE_ALIASES: Record<string, PlayerAction['type']> = {
  fold: 'fold',
  弃牌: 'fold',
  folded: 'fold',
  check: 'check',
  过牌: 'check',
  call: 'call',
  跟注: 'call',
  bet: 'bet',
  下注: 'bet',
  raise: 'raise',
  加注: 'raise',
  reraise: 'raise',
  'all-in': 'all-in',
  allin: 'all-in',
  all_in: 'all-in',
  allIn: 'all-in',
  全下: 'all-in',
  全押: 'all-in',
  shove: 'all-in',
}

function canonicalType(rawType: unknown): PlayerAction['type'] | null {
  if (typeof rawType !== 'string') return null
  return POKER_TYPE_ALIASES[rawType] ?? POKER_TYPE_ALIASES[rawType.toLowerCase()] ?? null
}

/**
 * LLM 动作 → 引擎 PlayerAction（引擎 validateAction/applyAction 才是最终裁决）。
 * 容错点：type 别名（中英/连字符）、amount↔toAmount 键名互换、
 * check↔call / bet↔raise 的语境互换（依当前注额而非硬性拒绝）。
 */
function coercePlayerAction(raw: unknown, state: MatchState): PlayerAction | null {
  const record = asRecord(raw)
  let type = canonicalType(record.type)
  if (type === null) return null

  const currentBet = state.hand?.currentBet ?? 0
  // 语境互换：无注可跟时 call→check；面临下注时 check→call
  if (type === 'call' && currentBet === 0) type = 'check'
  if (type === 'check' && currentBet > 0) type = 'call'
  // 语境互换：街内已有下注时 bet→raise；无下注时 raise→bet
  if (type === 'bet' && currentBet > 0) type = 'raise'
  if (type === 'raise' && currentBet === 0) type = 'bet'

  if (type === 'bet' || type === 'raise') {
    const amount =
      typeof record.toAmount === 'number' ? record.toAmount : typeof record.amount === 'number' ? record.amount : null
    if (amount === null) return null
    return type === 'bet' ? { type: 'bet', amount } : { type: 'raise', toAmount: amount }
  }
  return { type } as PlayerAction
}

// ---------------------------------------------------------------------------
// 印象信号（spec §5：hand-ended → synthesizeEpisodic；IO 归 GM）
// ---------------------------------------------------------------------------

const pokerMemory = new PokerMemoryModule()

type HandEndedResults = ReadonlyArray<{ seatId: string; startStack: number; endStack: number; delta: number; eliminated: boolean }>
type HandEndedRecord = Extract<PokerEvent, { kind: 'hand-ended' }> & Record<string, unknown>

function isHandEnded(value: unknown): value is HandEndedRecord {
  return isPokerEventPayload(value) && value.kind === 'hand-ended'
}

/**
 * 从 v2 事件流推导既有 memory.synthesizeEpisodic 所需的 v1 形状 finalState。
 * actionHistory 即工作记忆动作日志（spec §5「working memory 从 v2 事件流推导」）。
 */
function finalStateForHand(
  state: MatchState,
  handNumber: number,
  handEvents: ReadonlyArray<PokerEventRecord>,
  showdown: boolean,
  results: HandEndedResults,
): (targetAgentId: string) => unknown {
  const actionHistory = handEvents
    .filter(isActionMade)
    .map((event) => ({
      seq: event.seq,
      phase: event.street,
      agentId: event.seatId,
      action: {
        type: event.action.type,
        amount:
          event.action.type === 'bet' || event.action.type === 'raise'
            ? event.action.to
            : event.action.type === 'call'
              ? event.action.paid
              : undefined,
      },
    }))
  const players = state.players.map((player) => ({
    id: player.seatId,
    chips: player.stack,
    status: player.status,
    holeCards: player.revealed ? player.holeCards.map((card) => ({ ...card })) : [],
  }))
  return (targetAgentId: string) => ({
    actionHistory,
    players,
    handNumber,
    startingChips: results.find((row) => row.seatId === targetAgentId)?.startStack,
    phase: showdown ? 'showdown' : 'preflop',
    handComplete: true,
  })
}

const impressionsMemory: V2ImpressionsMemoryPort = {
  synthesizeEpisodic(input) {
    return pokerMemory.synthesizeEpisodic({
      // 工作记忆由 GM 从信号携带（形态即 v1 的 { matchActionsLog, currentHandNumber }）
      working: input.working as PokerWorkingMemory,
      finalState: input.finalState,
      observerAgentId: input.observerAgentId,
      targetAgentId: input.targetAgentId,
      matchId: input.matchId,
    })
  },
  updateSemantic(current, episodic) {
    return pokerMemory.updateSemantic(current as PokerSemanticProfile | null, episodic as PokerEpisodicEntry)
  },
  serializeEpisodic(episodic) {
    return pokerMemory.serialize.episodic(episodic as PokerEpisodicEntry)
  },
  serializeSemantic(semantic) {
    return pokerMemory.serialize.semantic(semantic as PokerSemanticProfile)
  },
  deserializeSemantic(raw) {
    return pokerMemory.deserialize.semantic(raw)
  },
  renderNote(input) {
    return generateImpressionParagraph({
      targetName: input.targetName,
      observerName: input.observerName,
      profile: input.semantic as PokerSemanticProfile,
      recentEpisodes: input.recentEpisodes as PokerEpisodicEntry[],
    })
  },
  handCountOf(profileJson) {
    return typeof profileJson.handCount === 'number' ? profileJson.handCount : null
  },
}

const impressions: V2Impressions = {
  fromBatch(state, batch, fullStream) {
    const pokerState = state as MatchState
    const signals: V2ImpressionsSignal[] = []
    // 完整流 = 落库前的全量 + 本批新事件（手牌结束级联可能整批产出）
    const stream = [
      ...fullStream.filter(isPokerEventPayload),
      ...batch.map((event) => event.raw).filter(isPokerEventPayload),
    ].sort((a, b) => a.seq - b.seq)
    for (const event of batch) {
      if (event.kind !== 'hand-ended') continue
      const raw = event.raw
      if (!isHandEnded(raw)) continue
      const handNumber = raw.handNumber
      const handEvents = stream.filter((candidate) => candidate.hand === handNumber)
      // 本手是否摊牌：以流中是否存在该手的亮牌事件判定
      const showdown = handEvents.some((candidate) => candidate.kind === 'cards-revealed')
      const workingLog = handEvents
        .filter(isActionMade)
        .map((candidate) => ({
          seq: candidate.seq,
          kind: 'poker:v2:action-made',
          actorAgentId: candidate.seatId,
          payload: { ...candidate },
        }))
      signals.push({
        handNumber,
        workingLog,
        finalStateFor: finalStateForHand(pokerState, handNumber, handEvents, showdown, raw.results),
      })
    }
    return signals
  },
  memory: impressionsMemory,
}

// ---------------------------------------------------------------------------
// 插件面实现
// ---------------------------------------------------------------------------

function toActionSpecs(state: MatchState): V2ActionSpec[] {
  const legal = legalActionSet(state)
  if (!legal) return []
  const specs: V2ActionSpec[] = []
  for (const action of legal.actions) {
    specs.push(toActionSpec(action))
  }
  return specs
}

function toActionSpec(action: LegalAction): V2ActionSpec {
  switch (action.type) {
    case 'fold':
      return { type: 'fold', label: '弃牌' }
    case 'check':
      return { type: 'check', label: '过牌' }
    case 'call':
      return { type: 'call', label: `跟注 ${action.amount}`, minAmount: action.amount, maxAmount: action.amount }
    case 'bet':
      return { type: 'bet', label: `下注 ${action.minTo}-${action.maxTo}`, minAmount: action.minTo, maxAmount: action.maxTo }
    case 'raise':
      return { type: 'raise', label: `加注到 ${action.minTo}-${action.maxTo}`, minAmount: action.minTo, maxAmount: action.maxTo }
    case 'all-in':
      return { type: 'all-in', label: `全下 ${action.to}`, minAmount: action.to, maxAmount: action.to }
  }
}

function finishToResult(state: MatchState): MatchResult {
  const finish = state.finish
  const ranking = (finish?.ranking ?? []).map((row) => ({
    agentId: row.seatId,
    rank: row.rank,
    score: row.chips,
    extra: { chips: row.chips },
  }))
  return {
    winnerFaction: ranking[0]?.agentId ?? null,
    ranking,
    stats: finish ? { reason: finish.reason, terminatedAt: finish.terminatedAt } : undefined,
  }
}

function rejectionOf(rejection: { code: string; message: string }): V2Rejection {
  return { code: rejection.code, message: rejection.message }
}

export const pokerPluginV2: GameModuleV2<MatchState, PlayerAction> = {
  gameType,

  createMatch(config, agentIds, seed) {
    const engineInput = { ...mapEngineConfig(config), seatIds: [...agentIds] }
    const outcome = engineCreateMatch(engineInput, seed ?? `${gameType}:${agentIds.join(',')}`)
    if (!outcome.ok) {
      return { ok: false, rejection: rejectionOf(outcome.rejection) }
    }
    return wrapCreate(outcome.state, outcome.events)
  },

  classify(state) {
    const cls = classifyState(state)
    if (cls.kind === 'finished') {
      return { kind: 'finished', result: finishToResult(state) }
    }
    return { kind: 'awaiting-action', actorAgentId: cls.actor }
  },

  legalActions(state) {
    return toActionSpecs(state)
  },

  decisionContext(state, actorAgentId) {
    const ctx = engineDecisionContext(state)
    if (ctx && ctx.actor === actorAgentId) {
      return {
        ...ctx,
        board: ctx.board.map(cardCode),
        actorHoleCards: ctx.actorHoleCards.map(cardCode),
      }
    }
    return {}
  },

  normalizeAction(raw, state, actorAgentId): V2NormalizeResult<PlayerAction> {
    const candidate = coercePlayerAction(raw, state)
    if (candidate === null) {
      return { ok: false, rejection: { code: 'INVALID_AMOUNT', message: '动作结构或类型无法识别（LLM 别名容错后仍非法）' } }
    }
    // 引擎 validateAction 是合法性的最终裁决（拒绝零副作用）
    const validated = validateAction(state, actorAgentId, candidate)
    if (!validated.ok) {
      return { ok: false, rejection: rejectionOf(validated.rejection) }
    }
    return { ok: true, action: candidate }
  },

  applyAction(state, actorAgentId, action) {
    return wrapApply(engineApplyAction(state, actorAgentId, action))
  },

  applyDefaultAction(state) {
    // 兜底策略：能过则过 → 能跟则跟 → 弃牌（保证对局推进且摊牌方差收敛）
    const legal = legalActionSet(state)
    if (!legal || state.currentActor === null) {
      return { ok: false, rejection: { code: 'ACTION_TYPE_UNAVAILABLE', message: '无当前行动者，无法执行默认动作' } }
    }
    const prefer: PlayerAction['type'][] = ['check', 'call', 'fold']
    const types = legal.actions.map((action) => action.type)
    const type = prefer.find((candidate) => types.includes(candidate)) ?? 'fold'
    return wrapApply(engineApplyAction(state, state.currentActor, { type } as PlayerAction))
  },

  requestStopAfterCurrentHand(state) {
    const outcome = engineRequestStop(state)
    if (!outcome.ok) return { state, events: [] } // 已终局：幂等 no-op
    return { state: outcome.state, events: outcome.events.map(toV2Event) }
  },

  terminateImmediately(state) {
    const outcome = engineTerminate(state)
    if (!outcome.ok) {
      return { ok: false, rejection: rejectionOf(outcome.rejection) }
    }
    return wrapCreate(outcome.state, outcome.events)
  },

  onEventsBatch() {
    // hand-ended 的印象合成信号经 impressions.fromBatch 交给 GM（IO 归 GM）；
    // 本钩子保留为 spec §2 的游戏专属扩展点（当前无额外纯逻辑）。
  },

  visibleEventsFor(fullStream, agentId) {
    const events = fullStream.filter(isPokerEventPayload)
    return filterEvents(events, { seat: agentId }).map((event) => ({ ...event }))
  },

  reserveEventSeq(state) {
    const seq = state.seq + 1
    return { state: { ...state, seq }, seq }
  },

  stateSummary(state) {
    return {
      handNumber: state.handNumber,
      day: 0,
      phase: state.hand?.street ?? (state.phase === 'finished' ? 'finished' : 'between-hands'),
    }
  },

  gameInfo(state) {
    return {
      gameType,
      seats: state.config.seatIds.length,
      seatIds: [...state.config.seatIds],
      startingStack: state.config.startingStack,
      blinds: { ...state.blinds },
      level: state.level,
      schedule: state.config.schedule
        ? { handsPerLevel: state.config.schedule.handsPerLevel, levels: state.config.schedule.levels.length }
        : null,
      ruleSet: 'no-limit Texas hold\'em (engine2)',
    }
  },

  impressions,

  presentation: pokerPresentation,
}
