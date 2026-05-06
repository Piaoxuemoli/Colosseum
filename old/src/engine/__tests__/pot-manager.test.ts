import { describe, it, expect } from 'vitest'
import { calculateSidePots } from '../../games/poker/engine/pot-manager'
import type { PlayerBet } from '../../games/poker/engine/pot-manager'

function totalOutput(pots: ReturnType<typeof calculateSidePots>): number {
  return pots.reduce((s, p) => s + p.amount, 0)
}

describe('calculateSidePots', () => {
  it('returns empty for empty bets', () => {
    expect(calculateSidePots([])).toEqual([])
  })

  it('creates single pot when no all-in', () => {
    const bets: PlayerBet[] = [
      { playerId: 'a', amount: 100, isAllIn: false, isFolded: false },
      { playerId: 'b', amount: 100, isAllIn: false, isFolded: false },
      { playerId: 'c', amount: 100, isAllIn: false, isFolded: false },
    ]
    const pots = calculateSidePots(bets)
    expect(pots).toHaveLength(1)
    expect(pots[0].amount).toBe(300)
    expect(pots[0].eligiblePlayerIds).toEqual(['a', 'b', 'c'])
    expect(totalOutput(pots)).toBe(300)
  })

  it('creates side pot when one player is all-in', () => {
    const bets: PlayerBet[] = [
      { playerId: 'a', amount: 50, isAllIn: true, isFolded: false },
      { playerId: 'b', amount: 100, isAllIn: false, isFolded: false },
      { playerId: 'c', amount: 100, isAllIn: false, isFolded: false },
    ]
    const pots = calculateSidePots(bets)
    expect(pots).toHaveLength(2)
    // Main pot: 50 * 3 = 150
    expect(pots[0].amount).toBe(150)
    expect(pots[0].eligiblePlayerIds).toContain('a')
    // Side pot: 50 * 2 = 100
    expect(pots[1].amount).toBe(100)
    expect(pots[1].eligiblePlayerIds).not.toContain('a')
    expect(totalOutput(pots)).toBe(250)
  })

  it('creates multiple side pots with different all-in levels', () => {
    const bets: PlayerBet[] = [
      { playerId: 'a', amount: 30, isAllIn: true, isFolded: false },
      { playerId: 'b', amount: 60, isAllIn: true, isFolded: false },
      { playerId: 'c', amount: 100, isAllIn: false, isFolded: false },
      { playerId: 'd', amount: 100, isAllIn: false, isFolded: false },
    ]
    const pots = calculateSidePots(bets)
    const totalIn = 30 + 60 + 100 + 100
    expect(totalOutput(pots)).toBe(totalIn)
    // Main pot: 30*4 = 120, eligible: a, b, c, d
    expect(pots[0].amount).toBe(120)
    // Side pot 1: 30*3 = 90, eligible: b, c, d
    expect(pots[1].amount).toBe(90)
    // Side pot 2: 40*2 = 80, eligible: c, d
    expect(pots[2].amount).toBe(80)
  })

  it('folded player contributes but does not compete', () => {
    const bets: PlayerBet[] = [
      { playerId: 'a', amount: 100, isAllIn: false, isFolded: true },
      { playerId: 'b', amount: 100, isAllIn: false, isFolded: false },
      { playerId: 'c', amount: 100, isAllIn: false, isFolded: false },
    ]
    const pots = calculateSidePots(bets)
    expect(totalOutput(pots)).toBe(300)
    // Folded player should not be in eligible list
    for (const pot of pots) {
      expect(pot.eligiblePlayerIds).not.toContain('a')
    }
  })

  it('does not lose chips when all eligible players folded (orphan pot)', () => {
    const bets: PlayerBet[] = [
      { playerId: 'a', amount: 50, isAllIn: true, isFolded: false },
      { playerId: 'b', amount: 100, isAllIn: false, isFolded: true },
      { playerId: 'c', amount: 100, isAllIn: false, isFolded: true },
    ]
    const totalIn = 50 + 100 + 100
    const pots = calculateSidePots(bets)
    expect(totalOutput(pots)).toBe(totalIn)
  })

  it('handles all same amount — single pot', () => {
    const bets: PlayerBet[] = [
      { playerId: 'a', amount: 50, isAllIn: false, isFolded: false },
      { playerId: 'b', amount: 50, isAllIn: false, isFolded: false },
    ]
    const pots = calculateSidePots(bets)
    expect(pots).toHaveLength(1)
    expect(pots[0].amount).toBe(100)
    expect(totalOutput(pots)).toBe(100)
  })

  it('conservation: input always equals output', () => {
    // Random-ish scenario
    const bets: PlayerBet[] = [
      { playerId: 'a', amount: 25, isAllIn: true, isFolded: false },
      { playerId: 'b', amount: 75, isAllIn: true, isFolded: false },
      { playerId: 'c', amount: 150, isAllIn: false, isFolded: false },
      { playerId: 'd', amount: 150, isAllIn: false, isFolded: true },
    ]
    const totalIn = bets.reduce((s, b) => s + b.amount, 0)
    const pots = calculateSidePots(bets)
    expect(totalOutput(pots)).toBe(totalIn)
  })

  it('conservation: single player all-in with multiple folders', () => {
    const bets: PlayerBet[] = [
      { playerId: 'a', amount: 200, isAllIn: true, isFolded: false },
      { playerId: 'b', amount: 50, isAllIn: false, isFolded: true },
      { playerId: 'c', amount: 50, isAllIn: false, isFolded: true },
    ]
    const totalIn = bets.reduce((s, b) => s + b.amount, 0)
    const pots = calculateSidePots(bets)
    expect(totalOutput(pots)).toBe(totalIn)
  })
})
