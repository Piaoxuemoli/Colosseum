// FR-4.9-01 ELO 天梯纯函数：多人零和两两更新 / 守恒 / K 有界 / 幂等重建。

import { describe, expect, it } from 'vitest'
import {
  applyEloMatch,
  ELO_INITIAL,
  ELO_K,
  expectedScore,
  initialEloState,
  rebuildEloLadder,
} from '@/platform/stats/elo'

describe('applyEloMatch — 双人对局', () => {
  it('equal ratings: winner gains exactly half K, loser mirrors (conservation)', () => {
    const { states, deltas } = applyEloMatch(
      [
        { agentId: 'a', won: true },
        { agentId: 'b', won: false },
      ],
      new Map(),
    )
    expect(deltas.get('a')).toBe(ELO_K / 2)
    expect(deltas.get('b')).toBe(-ELO_K / 2)
    expect(states.get('a')?.rating).toBe(ELO_INITIAL + 16)
    expect(states.get('b')?.rating).toBe(ELO_INITIAL - 16)
    // 双人和恒为 0。
    expect([...deltas.values()].reduce((sum, d) => sum + d, 0)).toBe(0)
  })

  it('favorite beats underdog: gains are small and conserved', () => {
    const states0 = new Map([
      ['a', { ...initialEloState(), rating: 1400 }],
      ['b', { ...initialEloState(), rating: 1000 }],
    ])
    const { deltas } = applyEloMatch(
      [
        { agentId: 'a', won: true },
        { agentId: 'b', won: false },
      ],
      states0,
    )
    // 强者胜加分 < 16（期望已高）；总和守恒。
    expect(deltas.get('a')!).toBeGreaterThan(0)
    expect(deltas.get('a')!).toBeLessThan(ELO_K / 2)
    expect(deltas.get('a')! + deltas.get('b')!).toBe(0)
  })

  it('counts wins/losses/matches and records lastDelta', () => {
    const { states } = applyEloMatch(
      [
        { agentId: 'a', won: true },
        { agentId: 'b', won: false },
      ],
      new Map(),
    )
    const a = states.get('a')!
    expect(a).toMatchObject({ matchesPlayed: 1, wins: 1, losses: 0, lastDelta: 16 })
  })
})

describe('applyEloMatch — 多人阵营局（胜方全员 vs 负方全员）', () => {
  const match6 = [
    { agentId: 'g1', won: true },
    { agentId: 'g2', won: true },
    { agentId: 'g3', won: true },
    { agentId: 'e1', won: false },
    { agentId: 'e2', won: false },
    { agentId: 'e3', won: false },
  ]

  it('is zero-sum across all players', () => {
    const { deltas } = applyEloMatch(match6, new Map())
    const sum = [...deltas.values()].reduce((s, d) => s + d, 0)
    expect(sum).toBe(0)
  })

  it('equal-rating factions: every winner gains, every loser drops', () => {
    const { deltas } = applyEloMatch(match6, new Map())
    for (const id of ['g1', 'g2', 'g3']) expect(deltas.get(id)).toBeGreaterThan(0)
    for (const id of ['e1', 'e2', 'e3']) expect(deltas.get(id)).toBeLessThan(0)
    // 阵营内无高下：同分者变动一致（口径 4：阵营内部不分高下）。
    expect(deltas.get('g1')).toBe(deltas.get('g2'))
    expect(deltas.get('g1')).toBe(deltas.get('g3'))
  })

  it('bounds any single delta within ±K', () => {
    const states0 = new Map([
      ['g1', { ...initialEloState(), rating: ELO_INITIAL + 600 }],
      ['g2', { ...initialEloState(), rating: ELO_INITIAL + 600 }],
      ['g3', { ...initialEloState(), rating: ELO_INITIAL + 600 }],
      ['e1', { ...initialEloState(), rating: ELO_INITIAL - 600 }],
      ['e2', { ...initialEloState(), rating: ELO_INITIAL - 600 }],
      ['e3', { ...initialEloState(), rating: ELO_INITIAL - 600 }],
    ])
    const { deltas } = applyEloMatch(match6, states0)
    for (const delta of deltas.values()) {
      expect(Math.abs(delta)).toBeLessThanOrEqual(ELO_K)
    }
  })
})

describe('expectedScore', () => {
  it('is 0.5 at equal ratings and monotone in rating gap', () => {
    expect(expectedScore(1000, 1000)).toBeCloseTo(0.5)
    expect(expectedScore(1200, 1000)).toBeGreaterThan(0.5)
    expect(expectedScore(1000, 1200)).toBeLessThan(0.5)
  })
})

describe('rebuildEloLadder — 幂等重建（口径 7）', () => {
  const history = [
    [
      { agentId: 'a', won: true },
      { agentId: 'b', won: false },
    ],
    [
      { agentId: 'b', won: true },
      { agentId: 'c', won: false },
    ],
    [
      { agentId: 'a', won: false },
      { agentId: 'b', won: true },
    ],
  ]

  it('replaying the same sequence yields identical ratings', () => {
    const one = rebuildEloLadder(history)
    const two = rebuildEloLadder(history)
    expect(one).toEqual(two)
  })

  it('order matters (time-ordered replay, not order-free aggregation)', () => {
    const forward = rebuildEloLadder(history)
    const reversed = rebuildEloLadder([...history].reverse())
    expect(forward.get('b')?.rating).not.toBe(reversed.get('b')?.rating)
  })
})
