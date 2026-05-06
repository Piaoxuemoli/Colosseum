import { describe, expect, it } from 'vitest'
import type { Card } from '../card'
import { computeEquity } from '../equity'

function c(value: string): Card {
  return {
    rank: value[0] as Card['rank'],
    suit: ({ h: 'hearts', d: 'diamonds', c: 'clubs', s: 'spades' } as const)[value[1] as 'h' | 'd' | 'c' | 's'],
  }
}

function seededRng(seed = 42) {
  let state = seed
  return () => {
    state = (state * 16_807) % 2_147_483_647
    return (state - 1) / 2_147_483_646
  }
}

describe('computeEquity', () => {
  it('AA vs 72o heavily favors AA', () => {
    const result = computeEquity({
      holes: [
        [c('Ah'), c('As')],
        [c('7c'), c('2d')],
      ],
      community: [],
      iterations: 1_000,
      rng: seededRng(),
    })

    expect(result[0]).toBeGreaterThan(0.75)
    expect(result[1]).toBeLessThan(0.25)
  })

  it('matched broadway hands on dry flop are roughly even', () => {
    const result = computeEquity({
      holes: [
        [c('Ah'), c('Kc')],
        [c('As'), c('Kd')],
      ],
      community: [c('2h'), c('5c'), c('9d')],
      iterations: 1_000,
      rng: seededRng(7),
    })

    expect(Math.abs(result[0] - result[1])).toBeLessThan(0.2)
  })
})
