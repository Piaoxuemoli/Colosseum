export interface PlayerBet {
  playerId: string
  amount: number
  isAllIn: boolean
  isFolded: boolean
}

export interface SidePot {
  amount: number
  eligiblePlayerIds: string[]
}

export function calculateSidePots(bets: PlayerBet[]): SidePot[] {
  if (bets.length === 0) return []

  const sorted = [...bets].sort((a, b) => a.amount - b.amount)
  const pots: SidePot[] = []
  let previousLevel = 0

  for (const bet of sorted) {
    const currentAmount = bet.amount
    if (currentAmount <= previousLevel) continue

    const levelDiff = currentAmount - previousLevel
    const contributors = sorted.filter((candidate) => candidate.amount > previousLevel)
    const eligiblePlayerIds = contributors.filter((candidate) => !candidate.isFolded).map((candidate) => candidate.playerId)
    const potAmount = levelDiff * contributors.length

    if (potAmount > 0 && eligiblePlayerIds.length > 0) {
      pots.push({ amount: potAmount, eligiblePlayerIds })
    } else if (potAmount > 0 && pots.length > 0) {
      pots[pots.length - 1].amount += potAmount
    }

    previousLevel = currentAmount
  }

  const totalIn = bets.reduce((sum, bet) => sum + bet.amount, 0)
  const totalOut = pots.reduce((sum, pot) => sum + pot.amount, 0)
  if (totalOut < totalIn && pots.length > 0) {
    pots[pots.length - 1].amount += totalIn - totalOut
  }

  return pots
}

export function mergePots(existing: SidePot[], newPots: SidePot[]): SidePot[] {
  return [...existing, ...newPots]
}
