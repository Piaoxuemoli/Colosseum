import { describe, it, expect } from 'vitest'
import { emaSmooth, clampScore, roundScore, applyMultiDimEMA } from '../utils/ema'

describe('emaSmooth', () => {
  it('should return raw on cold start (undefined current)', () => {
    expect(emaSmooth(undefined, 7, 0.3)).toBe(7)
  })

  it('should blend values with alpha', () => {
    // EMA: 0.3 * 10 + 0.7 * 5 = 3 + 3.5 = 6.5
    expect(emaSmooth(5, 10, 0.3)).toBeCloseTo(6.5)
  })

  it('should return current when alpha is 0', () => {
    expect(emaSmooth(5, 10, 0)).toBe(5)
  })

  it('should return raw when alpha is 1', () => {
    expect(emaSmooth(5, 10, 1)).toBe(10)
  })
})

describe('clampScore', () => {
  it('should clamp to default [1, 10]', () => {
    expect(clampScore(0)).toBe(1)
    expect(clampScore(15)).toBe(10)
    expect(clampScore(5.4)).toBe(5)
    expect(clampScore(5.6)).toBe(6)
  })

  it('should clamp to custom range', () => {
    expect(clampScore(0, 0, 100)).toBe(0)
    expect(clampScore(150, 0, 100)).toBe(100)
  })
})

describe('roundScore', () => {
  it('should round to 1 decimal', () => {
    expect(roundScore(3.14159)).toBe(3.1)
    expect(roundScore(3.15)).toBe(3.2)
    expect(roundScore(7)).toBe(7)
  })
})

describe('applyMultiDimEMA', () => {
  it('should use raw values on cold start', () => {
    const raw = { looseness: 7, aggression: 3 }
    const result = applyMultiDimEMA(undefined, raw, 0.3)
    expect(result.looseness).toBe(7)
    expect(result.aggression).toBe(3)
  })

  it('should smooth existing values', () => {
    const current = { looseness: 5, aggression: 5 }
    const raw = { looseness: 10, aggression: 1 }
    const result = applyMultiDimEMA(current, raw, 0.3)
    // looseness: 0.3*10 + 0.7*5 = 6.5
    expect(result.looseness).toBe(6.5)
    // aggression: 0.3*1 + 0.7*5 = 3.8
    expect(result.aggression).toBe(3.8)
  })

  it('should clamp raw values to range', () => {
    const raw = { score: 15 }
    const result = applyMultiDimEMA(undefined, raw, 0.3, [1, 10])
    expect(result.score).toBe(10)
  })

  it('should handle partial current (new dimension)', () => {
    const current = { looseness: 5 }
    const raw = { looseness: 8, newDim: 6 }
    const result = applyMultiDimEMA(current, raw, 0.3)
    expect(result.looseness).toBeDefined()
    expect(result.newDim).toBe(6) // cold start for new dim
  })
})
