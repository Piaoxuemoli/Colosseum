// AC-02 / PFR-206：min-raise 与不足额全下（full-bet 口径：不足额全下不重开行动）。
// AC 覆盖：加注到 8 → min re-raise 14；增量不足的全下不重开已行动者；postflop min bet = 1BB。

import { describe, expect, it } from 'vitest'
import { applyAction, legalActionSet } from '@/games/poker/engine2'
import type { LegalAction, MatchState } from '@/games/poker/engine2'
import { act, eventsOfKind, expectNoStall, findSeed, mkConfig, newMatch, play } from './testkit'

/** 找一个首手按钮 = 座位 0 的种子，保证 p0 = 按钮 / p1 = SB / p2 = BB（3 人局 UTG = 按钮）。 */
function seedButton0(players: number): number {
  return findSeed({ players, button: 0, where: () => true })
}

function betBounds(actions: readonly LegalAction[]): { minTo: number; maxTo: number } | null {
  const bet = actions.find((a) => a.type === 'bet')
  return bet && bet.type === 'bet' ? { minTo: bet.minTo, maxTo: bet.maxTo } : null
}

function raiseBounds(actions: readonly LegalAction[]): { minTo: number; maxTo: number } | null {
  const raise = actions.find((a) => a.type === 'raise')
  return raise && raise.type === 'raise' ? { minTo: raise.minTo, maxTo: raise.maxTo } : null
}

describe('AC-02 最小加注追踪', () => {
  it('盲注 1/2：UTG 加注到 8（增量 6）后，下一位最小 re-raise 至 14', () => {
    const created = newMatch(mkConfig(['p0', 'p1', 'p2'], 1000, 1, 2), seedButton0(3))
    expect(created.state.currentActor).toBe('p0')

    // 盲注视为首个下注：min raise-to = 2 + 2 = 4
    expect(raiseBounds(legalActionSet(created.state)?.actions ?? [])?.minTo).toBe(4)

    const s1 = act(created.state, 'p0', { type: 'raise', toAmount: 8 })
    expect(s1.currentActor).toBe('p1')
    const legal = legalActionSet(s1)
    expect(legal?.currentBet).toBe(8)
    expect(raiseBounds(legal?.actions ?? [])?.minTo).toBe(14)
  })

  it('postflop 首个下注最小额 = 1 BB，加注增量跨街重置（PFR-206）', () => {
    const created = newMatch(mkConfig(['p0', 'p1', 'p2'], 1000, 1, 2), seedButton0(3))
    const { state } = play(created.state, [
      ['p0', { type: 'call' }], // 按钮平跟 2
      ['p1', { type: 'call' }], // SB 补 1
      ['p2', { type: 'check' }], // BB option
    ])
    expect(state.hand?.street).toBe('flop')
    expect(state.currentActor).toBe('p1') // postflop 按钮左一（SB）先行动
    const legal = legalActionSet(state)
    expect(legal?.currentBet).toBe(0)
    expect(legal?.minRaiseTo).toBeNull()
    expect(betBounds(legal?.actions ?? [])?.minTo).toBe(2)
  })
})

describe('AC-02 不足额全下不重开行动（full-bet 口径）', () => {
  // 3 人各 18，盲注 1/2，按钮 p0：
  // p0 加注至 12（增量 10，min re-raise = 22）→ p1(SB, 余 17) 全下至 18（增量 6 < 10，不重开）
  // → p2(BB, 余 16) 跟至 18（全下）→ 回到 p0：只能跟 6 / 弃牌，不得加注
  function setup(): MatchState {
    const created = newMatch(mkConfig(['p0', 'p1', 'p2'], 18, 1, 2), seedButton0(3))
    return act(
      act(act(created.state, 'p0', { type: 'raise', toAmount: 12 }), 'p1', { type: 'all-in' }),
      'p2',
      { type: 'call' },
    )
  }

  it('已行动的 p0 面对不足额全下：只剩 fold / call /（等价跟注形式的）all-in，无 raise', () => {
    const s = setup()
    expect(s.currentActor).toBe('p0')
    const p1 = s.players.find((p) => p.seatId === 'p1')
    expect(p1?.status).toBe('all-in')
    expect(p1?.streetBet).toBe(18)

    const legal = legalActionSet(s)
    expect(legal?.toCall).toBe(6)
    expect(legal?.actions.map((a) => a.type)).toEqual(['fold', 'call', 'all-in'])
    expect(raiseBounds(legal?.actions ?? [])).toBeNull() // 无加注权

    const rejected = applyAction(s, 'p0', { type: 'raise', toAmount: 30 })
    expect(rejected.ok).toBe(false)
    if (!rejected.ok) expect(rejected.rejection.code).toBe('ACTION_TYPE_UNAVAILABLE')
  })

  it('p0 行动后引擎继续自动推进（run-out），无停滞', () => {
    const s = setup()
    const { state, events } = play(s, [['p0', { type: 'fold' }]])
    expect(eventsOfKind(events, 'run-out-started')).toHaveLength(1)
    expect(eventsOfKind(events, 'street-dealt').map((e) => e.street)).toEqual(['flop', 'turn', 'river'])
    expectNoStall(state)
  })
})

describe('PFR-206/207 金额边界拒绝', () => {
  it('低于最小加注且非全下 → BELOW_MIN_RAISE_NOT_ALL_IN，附合法区间', () => {
    const created = newMatch(mkConfig(['p0', 'p1', 'p2'], 1000, 1, 2), seedButton0(3))
    const s1 = act(created.state, 'p0', { type: 'raise', toAmount: 8 })
    const r = applyAction(s1, 'p1', { type: 'raise', toAmount: 11 })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.rejection.code).toBe('BELOW_MIN_RAISE_NOT_ALL_IN')
      expect(r.rejection.minTo).toBe(14)
      expect(r.rejection.maxTo).toBe(1000) // streetBet 1 + stack 999
    }
  })

  it('声明金额超过剩余筹码 → AMOUNT_ABOVE_MAX，不折算为全下（PFR-207）', () => {
    const created = newMatch(mkConfig(['p0', 'p1', 'p2'], 300, 1, 2), seedButton0(3))
    const r = applyAction(created.state, 'p0', { type: 'raise', toAmount: 500 })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.rejection.code).toBe('AMOUNT_ABOVE_MAX')
      expect(r.rejection.maxTo).toBe(300)
      expect(r.state).toBe(created.state) // 原状态引用不变
      expect(r.state.players[0].stack).toBe(300)
    }
  })

  it('面临下注时声明 bet → ACTION_TYPE_UNAVAILABLE（应使用 raise）', () => {
    const created = newMatch(mkConfig(['p0', 'p1', 'p2'], 1000, 1, 2), seedButton0(3))
    const s1 = act(created.state, 'p0', { type: 'raise', toAmount: 8 })
    const r = applyAction(s1, 'p1', { type: 'bet', amount: 20 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.rejection.code).toBe('ACTION_TYPE_UNAVAILABLE')
  })

  it('全下额即合法加注：声明 raise 至恰好全下额被接受（all-in 例外，PFR-207a）', () => {
    // p0 加注至 12（minRe 22），p1 全下至 18 < 22 但 = 其全部筹码 → 合法
    const created = newMatch(mkConfig(['p0', 'p1', 'p2'], 18, 1, 2), seedButton0(3))
    const s1 = act(created.state, 'p0', { type: 'raise', toAmount: 12 })
    const r = applyAction(s1, 'p1', { type: 'raise', toAmount: 18 })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.state.players.find((p) => p.seatId === 'p1')?.status).toBe('all-in')
    }
  })
})
