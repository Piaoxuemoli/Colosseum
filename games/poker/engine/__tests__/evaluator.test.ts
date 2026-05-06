import { describe, expect, it } from 'vitest'
import type { Card } from '../card'
import { evaluateHand } from '../evaluator'

function c(value: string): Card {
  return {
    rank: value[0] as Card['rank'],
    suit: ({ h: 'hearts', d: 'diamonds', c: 'clubs', s: 'spades' } as const)[value[1] as 'h' | 'd' | 'c' | 's'],
  }
}

function cards(...values: string[]): Card[] {
  return values.map(c)
}

describe('evaluateHand', () => {
  it('royal flush beats straight flush', () => {
    const royal = evaluateHand(cards('Ah', 'Kh', 'Qh', 'Jh', 'Th', '2c', '3d'))
    const straight = evaluateHand(cards('9h', '8h', '7h', '6h', '5h', 'Ac', '2d'))
    expect(royal.value).toBeGreaterThan(straight.value)
  })

  it('four of a kind beats full house', () => {
    const quads = evaluateHand(cards('Ah', 'As', 'Ac', 'Ad', 'Kh', '2c', '3d'))
    const full = evaluateHand(cards('Kh', 'Ks', 'Kc', 'Qh', 'Qd', '2c', '3d'))
    expect(quads.value).toBeGreaterThan(full.value)
  })

  it('flush beats straight', () => {
    const flush = evaluateHand(cards('Ah', '9h', '7h', '5h', '3h', '2c', 'Kd'))
    const straight = evaluateHand(cards('9h', '8c', '7d', '6h', '5s', 'Ac', '2d'))
    expect(flush.value).toBeGreaterThan(straight.value)
  })

  it('wheel A-2-3-4-5 is lowest straight', () => {
    const wheel = evaluateHand(cards('Ah', '2c', '3d', '4h', '5s', 'Kh', 'Qc'))
    const broadway = evaluateHand(cards('Ah', 'Kc', 'Qd', 'Jh', 'Ts', '2c', '3d'))
    expect(broadway.value).toBeGreaterThan(wheel.value)
  })

  it('identical high-card hands tie', () => {
    const a = evaluateHand(cards('Ah', 'Kc', 'Qd', 'Jh', '9s', '2c', '3d'))
    const b = evaluateHand(cards('As', 'Kh', 'Qc', 'Jd', '9c', '2h', '3s'))
    expect(a.value).toBe(b.value)
  })
})
