import type { Card } from '../../../types/card'

export type Position = 'UTG' | 'MP' | 'CO' | 'BTN' | 'SB' | 'BB'

/**
 * Determine player position based on seat index, dealer index, and total players.
 * For 6-max: BTN(dealer) → SB → BB → UTG → MP → CO
 */
export function getPosition(
  seatIndex: number,
  dealerIndex: number,
  totalPlayers: number
): Position {
  const offset = (seatIndex - dealerIndex + totalPlayers) % totalPlayers

  if (offset === 0) return 'BTN'
  if (offset === 1) return 'SB'
  if (offset === 2) return 'BB'

  // Remaining positions depend on total players
  if (totalPlayers === 6) {
    if (offset === 3) return 'UTG'
    if (offset === 4) return 'MP'
    if (offset === 5) return 'CO'
  } else if (totalPlayers === 5) {
    if (offset === 3) return 'UTG'
    if (offset === 4) return 'CO'
  } else if (totalPlayers === 4) {
    if (offset === 3) return 'CO'
  } else if (totalPlayers === 3) {
    // 3-max: BTN, SB, BB
  }

  return 'MP' // fallback
}

/**
 * Determine player position from a pre-computed offset (0-based from dealer).
 * Use this when seats may have gaps (non-consecutive seatIndex values).
 * offset 0 = dealer, offset 1 = SB, offset 2 = BB, etc.
 */
export function getPositionByOffset(
  offset: number,
  totalActivePlayers: number,
): Position {
  if (offset === 0) return 'BTN'
  if (offset === 1) return 'SB'
  if (offset === 2) return 'BB'

  if (totalActivePlayers === 6) {
    if (offset === 3) return 'UTG'
    if (offset === 4) return 'MP'
    if (offset === 5) return 'CO'
  } else if (totalActivePlayers === 5) {
    if (offset === 3) return 'UTG'
    if (offset === 4) return 'CO'
  } else if (totalActivePlayers === 4) {
    if (offset === 3) return 'CO'
  }

  return 'MP' // fallback
}

/**
 * Convert two hole cards to a standard notation like "AKs", "AKo", "AA"
 */
export function holeCardsToNotation(cards: Card[]): string {
  if (cards.length !== 2) return ''

  const [c1, c2] = cards
  const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A']
  const r1 = ranks.indexOf(c1.rank)
  const r2 = ranks.indexOf(c2.rank)

  const highRank = r1 >= r2 ? c1.rank : c2.rank
  const lowRank = r1 >= r2 ? c2.rank : c1.rank

  if (c1.rank === c2.rank) {
    return `${c1.rank}${c2.rank}` // Pair like "AA"
  }

  const suited = c1.suit === c2.suit ? 's' : 'o'
  return `${highRank}${lowRank}${suited}`
}

// Preflop hand tiers
const TIER1 = new Set([
  'AA', 'KK', 'QQ', 'JJ', 'AKs', 'AKo',
])

const TIER2 = new Set([
  'TT', '99', 'AQs', 'AQo', 'AJs', 'KQs',
])

const TIER3 = new Set([
  '88', '77', 'ATs', 'AJo', 'KJs', 'KQo', 'QJs', 'JTs',
])

const TIER4 = new Set([
  '66', '55', 'A9s', 'A8s', 'ATo', 'KTs', 'KJo', 'QJo', 'QTs', 'JTo', 'T9s', '98s',
])

const TIER5 = new Set([
  '44', '33', '22', 'A7s', 'A6s', 'A5s', 'A4s', 'A3s', 'A2s',
  'K9s', 'K8s', 'Q9s', 'J9s', 'T8s', '97s', '87s', '76s', '65s', '54s',
])

/**
 * Get the tier of a hand notation (1-5, or 0 if not in any range)
 */
export function getHandTier(notation: string): number {
  if (TIER1.has(notation)) return 1
  if (TIER2.has(notation)) return 2
  if (TIER3.has(notation)) return 3
  if (TIER4.has(notation)) return 4
  if (TIER5.has(notation)) return 5
  return 0
}

// Position-based range limits (what tier to open-raise from each position)
const POSITION_MAX_TIER: Record<Position, number> = {
  UTG: 2,  // Only tier 1-2
  MP: 3,   // Tier 1-3
  CO: 4,   // Tier 1-4
  BTN: 5,  // All tiers
  SB: 4,   // Tier 1-4
  BB: 5,   // All tiers (defending)
}

/**
 * Check if a hand notation is in the opening range for a given position
 */
export function isInRange(notation: string, position: Position): boolean {
  const tier = getHandTier(notation)
  if (tier === 0) return false
  return tier <= POSITION_MAX_TIER[position]
}
