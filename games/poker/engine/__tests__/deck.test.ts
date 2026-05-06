import { describe, expect, it } from 'vitest'
import { cardToString, createDeck, rankValue, shuffleDeck } from '../card'
import { dealCards } from '../deck'

describe('poker/engine/card', () => {
  it('createDeck returns 52 unique cards', () => {
    const deck = createDeck()
    expect(deck.length).toBe(52)
    expect(new Set(deck.map((card) => `${card.rank}${card.suit}`)).size).toBe(52)
  })

  it('shuffleDeck with fixed seed is deterministic', () => {
    const seeded = () => 0.42
    const a = shuffleDeck(createDeck(), seeded)
    const b = shuffleDeck(createDeck(), seeded)
    expect(a.map(cardToString)).toEqual(b.map(cardToString))
  })

  it('rankValue maps ace high and two low', () => {
    expect(rankValue('A')).toBe(14)
    expect(rankValue('2')).toBe(2)
  })

  it('cardToString formats correctly', () => {
    expect(cardToString({ suit: 'hearts', rank: 'A' })).toBe('Ah')
    expect(cardToString({ suit: 'clubs', rank: 'T' })).toBe('Tc')
  })
})

describe('poker/engine/deck', () => {
  it('dealCards splits deck correctly', () => {
    const { dealt, remaining } = dealCards(createDeck(), 5)
    expect(dealt.length).toBe(5)
    expect(remaining.length).toBe(47)
  })

  it('dealCards throws when not enough', () => {
    expect(() => dealCards(createDeck().slice(0, 3), 5)).toThrow(/Not enough/)
  })
})
