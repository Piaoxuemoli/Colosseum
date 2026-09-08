// engine2 v2 投影测试脚手架：用 engine2 纯逻辑 API 驱动整场对局，再按
// spec §3 的信封（kind = `${gameType}:v2:${kind}`，payload = engine2 事件
// 逐字段平铺含 audience，visibility/restrictedTo 由 audience 映射）转成
// GameEvent 喂给前端投影。事件形状与生产落库一致，而非手写 mock。

import {
  applyAction,
  classifyState,
  createMatch,
  requestStopAfterCurrentHand,
} from '@/games/poker/engine2'
import type { MatchState, PokerEvent } from '@/games/poker/engine2'
import type { WerewolfEvent } from '@/games/werewolf/engine2'
import type { GameEvent } from '@/platform/core/types'
import type { PokerUiPlayer } from '@/frontend/store/match-view-store'
import {
  SEATING_6,
  killVote,
  runDefaults,
  seerCheck,
  settleLastWords,
  speakAll,
  start6,
  step,
  witchPoisonPass,
  witchSavePass,
} from '../../../games/werewolf/engine2/_helpers'

export const MATCH_ID = 'match_v2_projection'
export const POKER_SEAT_IDS = ['agent-a', 'agent-b', 'agent-c'] as const
export const WEREWOLF_PLAYER_IDS = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'] as const

export function uiPlayer(agentId: string, displayName: string, seatIndex: number, chips: number): PokerUiPlayer {
  return {
    agentId,
    displayName,
    avatarEmoji: '🤖',
    seatIndex,
    chips,
    currentBet: 0,
    status: 'active',
    holeCards: [],
  }
}

export const POKER_ROSTER: PokerUiPlayer[] = [
  uiPlayer('agent-a', 'Alice', 0, 200),
  uiPlayer('agent-b', 'Bob', 1, 200),
  uiPlayer('agent-c', 'Carol', 2, 200),
]

export const WEREWOLF_ROSTER: PokerUiPlayer[] = WEREWOLF_PLAYER_IDS.map((id, index) =>
  uiPlayer(id, id.toUpperCase(), index, 0),
)

// ---------------------------------------------------------------------------
// 信封转换（spec §3）
// ---------------------------------------------------------------------------

function occurredAt(seq: number): string {
  return new Date(1_723_000_000_000 + seq).toISOString()
}

function actorOfPokerEvent(event: PokerEvent): string | null {
  return 'seatId' in event && typeof event.seatId === 'string' ? event.seatId : null
}

export function pokerEnvelope(event: PokerEvent, matchId = MATCH_ID): GameEvent {
  const audience = event.audience
  const restrictedTo =
    audience.kind === 'self'
      ? [`self:${audience.seatId}`]
      : audience.kind === 'delayed-public'
        ? ['delayed-public']
        : null
  return {
    id: `pk_${event.seq}`,
    matchId,
    gameType: 'poker',
    seq: event.seq,
    occurredAt: occurredAt(event.seq),
    kind: `poker:v2:${event.kind}`,
    actorAgentId: actorOfPokerEvent(event),
    payload: { ...event } as unknown as Record<string, unknown>,
    // 平台 zod 契约：非 public 受众落库为 role-restricted（spec §3 的
    // 「restricted」即该枚举值）。
    visibility: audience.kind === 'public' ? 'public' : 'role-restricted',
    restrictedTo,
  }
}

export function werewolfEnvelope(event: WerewolfEvent, matchId = MATCH_ID): GameEvent {
  const audience = event.audience
  const restrictedTo =
    audience.kind === 'public'
      ? null
      : audience.kind === 'role-self'
        ? [`role-self:${audience.playerId}`]
        : [audience.kind]
  return {
    id: `ww_${event.seq}`,
    matchId,
    gameType: 'werewolf',
    seq: event.seq,
    occurredAt: occurredAt(event.seq),
    kind: `werewolf:v2:${event.kind}`,
    actorAgentId: event.actorId,
    payload: { ...event } as unknown as Record<string, unknown>,
    visibility: audience.kind === 'public' ? 'public' : 'role-restricted',
    restrictedTo,
  }
}

/** 测试用的裸信封（未知 kind 前向兼容、legacy 事件混流等）。 */
export function rawEvent(
  gameType: 'poker' | 'werewolf',
  kind: string,
  payload: Record<string, unknown>,
  actorAgentId: string | null = null,
): GameEvent {
  return {
    id: `raw_${gameType}_${kind}_${Math.random().toString(36).slice(2, 8)}`,
    matchId: MATCH_ID,
    gameType,
    seq: 900_000 + Math.floor(Math.random() * 100_000),
    occurredAt: new Date(1_723_000_000_000).toISOString(),
    kind,
    actorAgentId,
    payload,
    visibility: 'public',
    restrictedTo: null,
  }
}

// ---------------------------------------------------------------------------
// 扑克：engine2 驱动的整场对局（手 1 弃牌快进；手 2 过牌到河牌摊牌；
// 之后受控结束），确定性种子保证可复现。
// ---------------------------------------------------------------------------

export interface PokerScript {
  state: MatchState
  events: PokerEvent[]
}

export function scriptedPokerMatch(): PokerScript {
  const created = createMatch(
    { seatIds: [...POKER_SEAT_IDS], startingStack: 200, blinds: { sb: 5, bb: 10 } },
    'engine2-projection-test',
  )
  if (!created.ok) throw new Error(created.rejection.message)
  const script: PokerScript = { state: created.state, events: [...created.events] }

  const stepActor = (preferences: ReadonlyArray<Record<string, unknown>>): void => {
    const actor = script.state.currentActor
    if (!actor) throw new Error('stepActor: no current actor')
    for (const preference of preferences) {
      const outcome = applyAction(script.state, actor, preference)
      if (outcome.ok) {
        script.state = outcome.state
        script.events.push(...outcome.events)
        return
      }
    }
    throw new Error(`stepActor: no legal action for ${actor} @ ${script.state.phase}/${script.state.hand?.street}`)
  }

  // 手 1：连续弃牌（无摊牌/无亮牌 → 用于 public 视角延迟揭示时序断言）。
  while (classifyState(script.state).kind === 'awaiting-action' && script.state.handNumber === 1) {
    stepActor([{ type: 'fold' }])
  }

  // 受控结束：手 2 打完即终局（顺路覆盖 stop-requested 事件）。
  const stop = requestStopAfterCurrentHand(script.state)
  if (!stop.ok) throw new Error(stop.rejection.message)
  script.state = stop.state
  script.events.push(...stop.events)

  // 手 2：一路 check/call 到河牌 → 强制亮牌摊牌 → 结算 → match-finished。
  while (classifyState(script.state).kind === 'awaiting-action') {
    stepActor([{ type: 'check' }, { type: 'call' }])
  }

  if (script.state.phase !== 'finished') throw new Error('script did not finish the match')
  return script
}

// ---------------------------------------------------------------------------
// 狼人杀：engine2 驱动的整场对局（6 人基础板：p1/p2 狼，p3 预言家，p4 女巫，
// p5/p6 平民）。夜 1 刀预言家 → 昼 1 遗言/发言/多数票放逐 p5 → 狼 2:2 达成
// parity 胜利 → gameEnded。
// ---------------------------------------------------------------------------

export interface WerewolfScript {
  state: ReturnType<typeof start6>['state']
  events: WerewolfEvent[]
}

export function scriptedWerewolfMatch(): WerewolfScript {
  const acc = start6(SEATING_6)

  // 夜 1：刀预言家 p3；女巫两问都过；预言家查验狼 p1。
  killVote(acc, 'p3')
  witchSavePass(acc)
  witchPoisonPass(acc)
  seerCheck(acc, 'p1')

  // 昼 1：p3 遗言 → 全员发言 → 多数票放逐 p5（狼 2:2 parity → 终局）。
  settleLastWords(acc, '遗言：我是真预言家')
  speakAll(acc, '我是好人')
  for (const [voter, target] of [
    ['p1', 'p5'],
    ['p2', 'p5'],
    ['p4', 'p5'],
    ['p5', 'p6'],
    ['p6', 'p4'],
  ] as const) {
    step(acc, { type: 'vote', actorId: voter, targetId: target })
  }
  // p5 的昼死遗言等收尾步骤走默认推进直到终局。
  runDefaults(acc, (a) => a.state.phase === 'ended')

  if (acc.state.phase !== 'ended') throw new Error('werewolf script did not end')
  return { state: acc.state, events: acc.events }
}

/** 流内定位某个 engine2 kind 的信封事件下标（找不到则抛错）。 */
export function indexOfKind(events: GameEvent[], kind: string, occurrence = 0): number {
  const indices = events.map((event, index) => (event.kind === kind ? index : -1)).filter((i) => i >= 0)
  const found = indices[occurrence]
  if (found === undefined) throw new Error(`no ${kind} event in stream (occurrence ${occurrence})`)
  return found
}

/** GM 持久化 agent/thinking 的 v2 形态（spec §3：audience=public，day/phase 由 v2 状态读出）。 */
export function thinkingEvent(agentId: string, day: number, phase: string, text: string): GameEvent {
  return {
    id: `think_${agentId}_${day}_${phase}`,
    matchId: MATCH_ID,
    gameType: 'werewolf',
    seq: 800_000 + day,
    occurredAt: new Date(1_723_000_000_000).toISOString(),
    kind: 'agent/thinking',
    actorAgentId: agentId,
    payload: { text, handNumber: 0, day, phase },
    visibility: 'public',
    restrictedTo: null,
  }
}
