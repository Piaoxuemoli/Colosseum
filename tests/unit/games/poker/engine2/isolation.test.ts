// AC-09 信息隔离 / PFR-403：观众与其他选手在终局前获取不到未揭示底牌；
// self:<seat> 仅本人；延迟公开按手结算后转公开；上帝视角为显式授权的全量通道。

import { describe, expect, it } from 'vitest'
import { filterEvents } from '@/games/poker/engine2'
import type { PokerEvent } from '@/games/poker/engine2'
import { driver, eventsOfKind, findSeed, mkConfig } from './testkit'

/** 打一手到摊牌（3 人，p2 翻前弃牌，p0/p1 打满四街到摊牌）。 */
function showdownMatch() {
  const seed = findSeed({ players: 3, button: 0, where: () => true })
  const d = driver(mkConfig(['p0', 'p1', 'p2'], 500, 5, 10), seed)
  d.step('p0', { type: 'raise', toAmount: 30 })
  d.step('p1', { type: 'call' })
  d.step('p2', { type: 'fold' })
  d.step('p1', { type: 'check' }) // flop
  d.step('p0', { type: 'bet', amount: 50 })
  d.step('p1', { type: 'call' })
  d.step('p1', { type: 'check' }) // turn
  d.step('p0', { type: 'check' })
  d.step('p1', { type: 'check' }) // river
  d.step('p0', { type: 'bet', amount: 100 })
  d.step('p1', { type: 'call' }) // → 摊牌 + 结算 + 手 2 开始
  return d
}

describe('AC-09 底牌信息隔离（PFR-403）', () => {
  it('观众视角：摊牌前投影不含任何未揭示底牌内容（含明文与可检索等价物）', () => {
    const d = showdownMatch()
    const firstReveal = d.events.findIndex((e) => e.kind === 'cards-revealed')
    expect(firstReveal).toBeGreaterThan(0)
    const prefix = d.events.slice(0, firstReveal)
    const spectator = filterEvents(prefix, 'spectator')

    // 无 hole-cards-dealt 事件
    expect(spectator.filter((e) => e.kind === 'hole-cards-dealt')).toHaveLength(0)
    // 无洗牌种子（延迟公开）
    expect(spectator.filter((e) => e.kind === 'deck-shuffled')).toHaveLength(0)
    // 信息泄露审计：所有未揭示底牌的卡对象（明文/等价物）不出现在任何观众可见载荷中
    const holeObjs = holeCardObjects(prefix)
    expect(holeObjs.length).toBe(6) // 3 家 × 2 张
    const serialized = JSON.stringify(spectator)
    for (const card of holeObjs) {
      expect(serialized.includes(JSON.stringify(card))).toBe(false)
    }
  })

  it('选手视角：仅可见自己的底牌事件，他人底牌终局前 amount 为零', () => {
    const d = showdownMatch()
    const firstReveal = d.events.findIndex((e) => e.kind === 'cards-revealed')
    const prefix = d.events.slice(0, firstReveal)

    const asP0 = filterEvents(prefix, { seat: 'p0' })
    const dealt0 = eventsOfKind(asP0, 'hole-cards-dealt')
    expect(dealt0.map((e) => e.seatId)).toEqual(['p0'])

    const asP2 = filterEvents(prefix, { seat: 'p2' })
    expect(eventsOfKind(asP2, 'hole-cards-dealt').map((e) => e.seatId)).toEqual(['p2'])
    // p2 已弃牌：其底牌对任何人（除自己/审计/上帝）不揭示
    expect(eventsOfKind(filterEvents(d.events, 'spectator'), 'cards-revealed').map((e) => e.seatId)).not.toContain('p2')
  })

  it('上帝视角通道（PFR-403）：观战呈现层显式授权，可见全部底牌；不影响三级默认可见性', () => {
    const d = showdownMatch()
    const firstReveal = d.events.findIndex((e) => e.kind === 'cards-revealed')
    const prefix = d.events.slice(0, firstReveal)

    const god = filterEvents(prefix, 'god')
    expect(eventsOfKind(god, 'hole-cards-dealt')).toHaveLength(3)
    expect(eventsOfKind(god, 'deck-shuffled')).toHaveLength(1)
    // 上帝视角不改变默认可见性：观众投影依旧无底牌
    expect(eventsOfKind(filterEvents(prefix, 'spectator'), 'hole-cards-dealt')).toHaveLength(0)
  })

  it('审计视角：延迟公开事件即时可见；观众在结算后可见、结算前不可见（PFR-402）', () => {
    const d = showdownMatch()
    const firstReveal = d.events.findIndex((e) => e.kind === 'cards-revealed')
    const prefix = d.events.slice(0, firstReveal)
    const handEndedSeq = eventsOfKind(d.events, 'hand-ended')[0]?.seq

    // 结算前：观众看不到洗牌种子；审计可以
    expect(filterEvents(prefix, 'spectator').some((e) => e.kind === 'deck-shuffled')).toBe(false)
    expect(filterEvents(prefix, 'auditor').some((e) => e.kind === 'deck-shuffled')).toBe(true)
    // 结算后（含 hand-ended 的完整流）：观众可见
    const after = d.events.filter((e) => e.seq <= handEndedSeq)
    expect(filterEvents(after, 'spectator').some((e) => e.kind === 'deck-shuffled' && e.hand === 1)).toBe(true)
  })

  it('已揭示底牌在后续投影中保持可见（PFR-403）', () => {
    const d = showdownMatch()
    const spectator = filterEvents(d.events, 'spectator')
    const reveals = eventsOfKind(spectator, 'cards-revealed')
    expect(reveals.map((r) => r.seatId).sort()).toEqual(['p0', 'p1'])
    expect(reveals.every((r) => r.cards.length === 2)).toBe(true)
  })
})

function holeCardObjects(events: readonly PokerEvent[]): Array<{ rank: string; suit: string }> {
  return eventsOfKind(events, 'hole-cards-dealt').flatMap((e) => e.cards)
}
