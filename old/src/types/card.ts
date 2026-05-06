export const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'] as const
export type Suit = typeof SUITS[number]

export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const
export type Rank = typeof RANKS[number]

export interface Card {
  suit: Suit
  rank: Rank
}

export function rankValue(rank: Rank): number {
  return RANKS.indexOf(rank) + 2
}

export function createDeck(): Card[] {
  const deck: Card[] = []
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank })
    }
  }
  return deck
}

export function shuffleDeck(deck: Card[]): Card[] {
  const s = [...deck]
  for (let i = s.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [s[i], s[j]] = [s[j], s[i]]
  }
  return s
}

export function cardToString(card: Card): string {
  const suitChar: Record<Suit, string> = {
    hearts: 'h',
    diamonds: 'd',
    clubs: 'c',
    spades: 's',
  }
  return `${card.rank}${suitChar[card.suit]}`
}
