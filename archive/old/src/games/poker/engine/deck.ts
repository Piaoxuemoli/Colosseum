import type { Card } from '../../../types/card'

export interface DealResult {
  dealt: Card[]
  remaining: Card[]
}

export function dealCards(deck: Card[], count: number): DealResult {
  if (deck.length < count) {
    throw new Error(`Not enough cards: need ${count}, have ${deck.length}`)
  }
  return {
    dealt: deck.slice(0, count),
    remaining: deck.slice(count),
  }
}
