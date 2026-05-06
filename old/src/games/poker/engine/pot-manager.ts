import type { SidePot } from '../../../types/game'

export interface PlayerBet {
  playerId: string
  amount: number
  isAllIn: boolean
  isFolded: boolean
}

/**
 * Calculate main pot and side pots from player bets.
 * Uses the standard poker side pot algorithm:
 * 1. Sort by bet amount ascending
 * 2. At each all-in level, split off a pot
 */
export function calculateSidePots(bets: PlayerBet[]): SidePot[] {
  if (bets.length === 0) return []

  // Sort by amount ascending
  const sorted = [...bets].sort((a, b) => a.amount - b.amount)
  const pots: SidePot[] = []

  let previousLevel = 0

  for (let i = 0; i < sorted.length; i++) {
    const currentAmount = sorted[i].amount

    if (currentAmount <= previousLevel) continue

    const levelDiff = currentAmount - previousLevel

    // All players who contributed at this level (amount > previousLevel)
    // contribute to the pot, but only non-folded players are eligible to win
    const contributors = sorted.filter(b => b.amount > previousLevel)
    const eligiblePlayers = contributors
      .filter(b => !b.isFolded)
      .map(b => b.playerId)

    const potAmount = levelDiff * contributors.length

    if (potAmount > 0 && eligiblePlayers.length > 0) {
      pots.push({
        amount: potAmount,
        eligiblePlayerIds: eligiblePlayers,
      })
    } else if (potAmount > 0 && eligiblePlayers.length === 0) {
      // All eligible players folded — add to next pot or last pot
      if (pots.length > 0) {
        pots[pots.length - 1].amount += potAmount
      } else {
        // Edge case: will be picked up by contenders
        pots.push({
          amount: potAmount,
          eligiblePlayerIds: sorted.filter(b => !b.isFolded).map(b => b.playerId),
        })
      }
    }

    previousLevel = currentAmount
  }

  // Conservation check: ensure total output matches total input
  const totalIn = bets.reduce((s, b) => s + b.amount, 0)
  const totalOut = pots.reduce((s, p) => s + p.amount, 0)
  if (totalOut < totalIn && pots.length > 0) {
    pots[pots.length - 1].amount += (totalIn - totalOut)
  }

  return pots
}

/**
 * Merge existing side pots (used when accumulating across streets).
 */
export function mergePots(existing: SidePot[], newPots: SidePot[]): SidePot[] {
  return [...existing, ...newPots]
}
