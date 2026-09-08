// 引擎 v2 测试工具：种子搜索（构造牌局）+ 脚本驱动 + 常用断言辅助。
// 确定性策略：不 mock 随机源，而是搜索满足牌面条件的 master 种子（PFR-404 纯种子通道）。
// 注意：精确匹配 11+ 张特定牌的概率天文级小，条件必须用"谓词"（如牌型价值排序）而非精确牌码。

import { expect } from 'vitest'
import {
  applyAction,
  cardCodes,
  classifyState,
  createMatch,
  createOrderedDeck,
  dealLayout,
  evaluateBest,
  firstButtonSeat,
  handSeedFrom,
  hashSeed,
  mulberry32,
  shuffled,
} from '@/games/poker/engine2'
import type { Card, MatchConfigInput, MatchState, PokerEvent } from '@/games/poker/engine2'

export interface DealLayoutPreview {
  holeCards: Card[][]
  board: Card[]
}

/** 某种子下某手的发牌布局（含牌对象，可用于 evaluateBest 等计算）。 */
export function layoutFor(seed: number, players: number, hand: number): DealLayoutPreview {
  const master = hashSeed(seed)
  const deck = shuffled(createOrderedDeck(), mulberry32(handSeedFrom(master, hand)))
  return dealLayout(deck, players)
}

/**
 * 搜索 master 种子：满足首手按钮位与牌面条件。
 * `where` 收到首手布局与按手号取布局的访问器 at(hand, aliveCount?)（跨手构造时用；
 * 手 n 的 aliveCount 必须传该手的存活人数——发牌只发给存活座位，升序）。
 */
export function findSeed(opts: {
  players: number
  button?: number
  where: (layout: DealLayoutPreview, at: (hand: number, aliveCount?: number) => DealLayoutPreview) => boolean
  from?: number
}): number {
  const from = opts.from ?? 0
  for (let seed = from; seed < from + 2_000_000; seed++) {
    const master = hashSeed(seed)
    if (opts.button !== undefined && firstButtonSeat(master, opts.players) !== opts.button) continue
    const at = (hand: number, aliveCount = opts.players) => layoutFor(seed, aliveCount, hand)
    if (opts.where(at(1), at)) {
      return seed
    }
  }
  throw new Error(`findSeed: 未找到满足条件的种子（from=${from}）`)
}

/** 便捷：按牌型价值严格排序（v(seats[0]) > v(seats[1]) > ...）。 */
export function valueOrder(layout: DealLayoutPreview, seats: readonly number[]): boolean {
  const values = seats.map((i) => evalValue(layout, i))
  return values.every((v, i) => i === 0 || values[i - 1] > v)
}

export function evalValue(layout: DealLayoutPreview, seat: number): number {
  const hole = layout.holeCards[seat]
  if (!hole) throw new Error(`evalValue: 座位 ${seat} 不存在`)
  return evaluateBest([...hole, ...layout.board]).value
}

export function codesOf(cards: readonly Card[]): string[] {
  return cardCodes(cards)
}

export function cardOf(card: Card): string {
  return cardCodes([card])[0]
}

export function mkConfig(
  seatIds: string[],
  startingStack: number,
  sb: number,
  bb: number,
  schedule?: MatchConfigInput['schedule'],
): MatchConfigInput {
  return { seatIds, startingStack, blinds: { sb, bb }, ...(schedule ? { schedule } : {}) }
}

export function newMatch(config: MatchConfigInput, seed: number | string) {
  const r = createMatch(config, seed)
  if (!r.ok) throw new Error(`createMatch 失败: ${r.rejection.code} ${r.rejection.message}`)
  return r
}

export function act(state: MatchState, seatId: string, action: unknown): MatchState {
  const r = applyAction(state, seatId, action)
  if (!r.ok) {
    throw new Error(`动作被拒绝: ${seatId} ${JSON.stringify(action)} → ${r.rejection.code}: ${r.rejection.message}`)
  }
  return r.state
}

export function tryAct(state: MatchState, seatId: string, action: unknown): ReturnType<typeof applyAction> {
  return applyAction(state, seatId, action)
}

/** 带全量事件累积（含 createMatch 引导事件）的逐步驱动器。 */
export function driver(config: MatchConfigInput, seed: number | string) {
  const created = newMatch(config, seed)
  let state = created.state
  const events: PokerEvent[] = [...created.events]
  return {
    get state(): MatchState {
      return state
    },
    get events(): PokerEvent[] {
      return events
    },
    step(seatId: string, action: unknown): MatchState {
      const r = applyAction(state, seatId, action)
      if (!r.ok) {
        throw new Error(`step 被拒: ${seatId} ${JSON.stringify(action)} → ${r.rejection.code}: ${r.rejection.message}`)
      }
      state = r.state
      events.push(...r.events)
      return state
    },
  }
}

export interface PlayResult {
  state: MatchState
  events: PokerEvent[]
}

export function play(start: MatchState, steps: ReadonlyArray<[string, unknown]>): PlayResult {
  let state = start
  const events: PokerEvent[] = []
  for (const [seatId, action] of steps) {
    const r = applyAction(state, seatId, action)
    if (!r.ok) {
      throw new Error(`play: 动作被拒绝: ${seatId} ${JSON.stringify(action)} → ${r.rejection.code}: ${r.rejection.message}`)
    }
    state = r.state
    events.push(...r.events)
  }
  return { state, events }
}

/** PFR-302 不变式：任何返回状态要么有唯一行动者，要么已终局。 */
export function expectNoStall(state: MatchState): void {
  const c = classifyState(state)
  expect(['awaiting-action', 'finished']).toContain(c.kind)
  if (c.kind === 'awaiting-action') {
    expect(c.actor.length).toBeGreaterThan(0)
  }
}

export function eventsOfKind<E extends PokerEvent['kind']>(events: readonly PokerEvent[], kind: E): Extract<PokerEvent, { kind: E }>[] {
  return events.filter((e) => e.kind === kind) as Extract<PokerEvent, { kind: E }>[]
}

export function stackOf(state: MatchState, seatId: string): number {
  const p = state.players.find((x) => x.seatId === seatId)
  if (!p) throw new Error(`stackOf: 未知座位 ${seatId}`)
  return p.stack
}

export function cardsFromCodes(codes: readonly string[]): Card[] {
  return codes.map((code) => {
    const rank = code.slice(0, code.length - 1) as Card['rank']
    const suit = code[code.length - 1]
    const suitMap: Record<string, Card['suit']> = { s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' }
    const s = suitMap[suit]
    if (!s) throw new Error(`cardsFromCodes: 非法花色 ${code}`)
    return { rank, suit: s }
  })
}
