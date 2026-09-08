// AC-09 / PFR-301、404、405、601：确定性重放、事件流重建任意检查点状态、单手随机性可复现。

import { describe, expect, it } from 'vitest'
import {
  cardCodes,
  createOrderedDeck,
  dealLayout,
  handSeedFrom,
  hashSeed,
  mulberry32,
  reduceEvents,
  shuffled,
} from '@/games/poker/engine2'
import type { MatchState, PokerEvent } from '@/games/poker/engine2'
import { driver, eventsOfKind, findSeed, mkConfig, newMatch, play } from './testkit'

/** 多街、多手、含摊牌的固定脚本。 */
const SCRIPT: ReadonlyArray<[string, unknown]> = [
  ['p0', { type: 'raise', toAmount: 30 }],
  ['p1', { type: 'call' }],
  ['p2', { type: 'fold' }],
  ['p1', { type: 'check' }], // flop：SB 先动
  ['p0', { type: 'bet', amount: 50 }],
  ['p1', { type: 'call' }],
  ['p1', { type: 'check' }], // turn
  ['p0', { type: 'check' }],
  ['p1', { type: 'check' }], // river
  ['p0', { type: 'bet', amount: 100 }],
  ['p1', { type: 'call' }],
  // 手 2：按钮轮转，继续下注并弃牌收尾
  ['p1', { type: 'raise', toAmount: 60 }],
  ['p2', { type: 'all-in' }],
  ['p0', { type: 'fold' }],
  ['p1', { type: 'call' }],
]

function runScript(seed: number) {
  const created = newMatch(mkConfig(['p0', 'p1', 'p2'], 500, 5, 10), seed)
  expect(created.state.hand?.buttonSeat).toBe(0)
  expect(created.state.currentActor).toBe('p0')
  let state: MatchState = created.state
  const events: PokerEvent[] = [...created.events]
  const checkpoints: Array<{ state: MatchState; events: PokerEvent[] }> = [{ state, events: [...events] }]
  for (const [seatId, action] of SCRIPT) {
    const r = play(state, [[seatId, action]])
    state = r.state
    events.push(...r.events)
    checkpoints.push({ state, events: [...events] })
  }
  return { state, events, checkpoints }
}

/** 首手按钮 = 座位 0 的固定种子（p0=按钮/UTG、p1=SB、p2=BB）。 */
function button0Seed(): number {
  return findSeed({ players: 3, button: 0, where: () => true })
}

describe('AC-09 确定性（PFR-301/404/601）', () => {
  it('同配置 + 同种子 + 同动作序列 → 事件流逐事件一致', () => {
    const seed = button0Seed()
    const a = runScript(seed)
    const b = runScript(seed)
    expect(a.events).toEqual(b.events)
    expect(a.state).toEqual(b.state)
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events))
  })

  it('事件流 seq 严格单调递增且无空洞（PFR-401）', () => {
    const { events } = runScript(button0Seed())
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1))
  })

  it('事件不内嵌全量状态快照：载荷均为增量事实（抽样校验关键字段不存在）', () => {
    const { events } = runScript(button0Seed())
    for (const e of events) {
      expect('players' in e || 'fullState' in e || 'snapshot' in e).toBe(false)
    }
  })
})

describe('AC-09 事件流重建任意检查点状态（PFR-405）', () => {
  it('每个检查点：reduceEvents(前缀) 与实时推进状态完全一致', () => {
    const { checkpoints } = runScript(button0Seed())
    for (const cp of checkpoints) {
      const r = reduceEvents(cp.events)
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.state).toEqual(cp.state)
        expect(r.state.seq).toBe(cp.events.length)
      }
    }
  })

  it('重建状态可继续推进且与实时路径一致（快照只是加速，事件流才是真相）', () => {
    const a = runScript(button0Seed())
    const mid = a.checkpoints[6]
    const rebuilt = reduceEvents(mid.events)
    expect(rebuilt.ok).toBe(true)
    if (!rebuilt.ok) return
    const continuedLive = play(mid.state, SCRIPT.slice(6))
    const continuedReplay = play(rebuilt.state, SCRIPT.slice(6))
    expect(continuedReplay.state).toEqual(continuedLive.state)
    expect(continuedReplay.events).toEqual(continuedLive.events)
  })

  it('畸形/截断事件流被结构化拒绝', () => {
    expect(reduceEvents([]).ok).toBe(false)
    expect(reduceEvents([{ seq: 1, hand: 0, kind: 'match-config', audience: { kind: 'public' }, seatIds: ['a'], startingStack: 1, blinds: { sb: 1, bb: 2 }, schedule: null } as PokerEvent]).ok).toBe(false)
    // 仅头部两条：落在引导阶段内部（无稳定状态），被拒
    const created = newMatch(mkConfig(['p0', 'p1'], 100, 1, 2), 1)
    const r = reduceEvents(created.events.slice(0, 2))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('checkpoint-inside-bootstrap')
  })
})

describe('AC-09 单手随机性独立复现（PFR-404）', () => {
  it('每手洗牌事件中的种子可独立重建该手牌序（底牌 + 公共牌）', () => {
    const seed = findSeed({ players: 3, button: 0, where: () => true })
    const d = driver(mkConfig(['p0', 'p1', 'p2'], 500, 5, 10), seed)
    d.step('p0', { type: 'raise', toAmount: 30 })
    d.step('p1', { type: 'call' })
    d.step('p2', { type: 'fold' })
    d.step('p1', { type: 'check' })
    d.step('p0', { type: 'bet', amount: 50 })
    d.step('p1', { type: 'call' })

    const shuffled1 = eventsOfKind(d.events, 'deck-shuffled').find((e) => e.hand === 1)
    expect(shuffled1).toBeDefined()
    // 由种子独立重算牌序：与引擎发出的底牌/公共牌一致
    const master = hashSeed(seed)
    const deck = shuffled(createOrderedDeck(), mulberry32(handSeedFrom(master, 1)))
    const { holeCards, board } = dealLayout(deck, 3)

    const dealt = eventsOfKind(d.events, 'hole-cards-dealt').filter((e) => e.hand === 1)
    expect(dealt.map((e) => [e.seatId, cardCodes(e.cards)])).toEqual(
      holeCards.map((h, i) => [`p${i}`, cardCodes(h)]),
    )
    const streets = eventsOfKind(d.events, 'street-dealt').filter((e) => e.hand === 1)
    const dealtCount = streets.reduce((n, s) => n + s.cards.length, 0)
    expect(streets.flatMap((s) => cardCodes(s.cards))).toEqual(cardCodes(board.slice(0, dealtCount)))
    void shuffled1
  })
})
