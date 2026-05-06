import { describe, expect, it } from 'vitest'
import { applyEMA } from '../ema'

describe('applyEMA', () => {
  it('cold start uses raw directly', () => {
    const result = applyEMA(undefined, {
      looseness: 7,
      aggression: 8,
      stickiness: 5,
      honesty: 6,
      note: 'test',
    })

    expect(result.looseness).toBe(7)
    expect(result.handCount).toBe(1)
  })

  it('blends with existing via alpha=0.3', () => {
    const result = applyEMA(
      { looseness: 5, aggression: 5, stickiness: 5, honesty: 5, note: 'x', handCount: 10 },
      { looseness: 10, aggression: 10, stickiness: 10, honesty: 10, note: 'y' },
    )

    expect(result.looseness).toBeCloseTo(6.5, 1)
    expect(result.handCount).toBe(11)
  })

  it('clamps to [1,10]', () => {
    const result = applyEMA(undefined, {
      looseness: 15,
      aggression: -3,
      stickiness: 5,
      honesty: 7,
      note: '',
    })

    expect(result.looseness).toBe(10)
    expect(result.aggression).toBe(1)
  })
})
