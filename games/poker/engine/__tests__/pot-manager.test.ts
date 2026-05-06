import { describe, expect, it } from 'vitest'
import { calculateSidePots } from '../pot-manager'

describe('calculateSidePots', () => {
  it('single pot when all equal bets', () => {
    const pots = calculateSidePots([
      { playerId: 'a', amount: 100, isAllIn: false, isFolded: false },
      { playerId: 'b', amount: 100, isAllIn: false, isFolded: false },
      { playerId: 'c', amount: 100, isAllIn: false, isFolded: false },
    ])

    expect(pots).toHaveLength(1)
    expect(pots[0].amount).toBe(300)
    expect(pots[0].eligiblePlayerIds.sort()).toEqual(['a', 'b', 'c'])
  })

  it('side pot when one player all-in short', () => {
    const pots = calculateSidePots([
      { playerId: 'a', amount: 50, isAllIn: true, isFolded: false },
      { playerId: 'b', amount: 100, isAllIn: false, isFolded: false },
      { playerId: 'c', amount: 100, isAllIn: false, isFolded: false },
    ])

    expect(pots).toHaveLength(2)
    expect(pots[0].amount).toBe(150)
    expect(pots[0].eligiblePlayerIds.sort()).toEqual(['a', 'b', 'c'])
    expect(pots[1].amount).toBe(100)
    expect(pots[1].eligiblePlayerIds.sort()).toEqual(['b', 'c'])
  })

  it('folded player contributes but is not eligible', () => {
    const pots = calculateSidePots([
      { playerId: 'a', amount: 100, isAllIn: false, isFolded: true },
      { playerId: 'b', amount: 100, isAllIn: false, isFolded: false },
      { playerId: 'c', amount: 100, isAllIn: false, isFolded: false },
    ])

    expect(pots).toHaveLength(1)
    expect(pots[0].amount).toBe(300)
    expect(pots[0].eligiblePlayerIds.sort()).toEqual(['b', 'c'])
  })

  it('conserves total chips across complex side pots', () => {
    const bets = [
      { playerId: 'a', amount: 30, isAllIn: true, isFolded: false },
      { playerId: 'b', amount: 70, isAllIn: true, isFolded: false },
      { playerId: 'c', amount: 100, isAllIn: false, isFolded: false },
      { playerId: 'd', amount: 100, isAllIn: false, isFolded: true },
    ]
    const pots = calculateSidePots(bets)

    expect(pots.reduce((sum, pot) => sum + pot.amount, 0)).toBe(bets.reduce((sum, bet) => sum + bet.amount, 0))
  })
})
