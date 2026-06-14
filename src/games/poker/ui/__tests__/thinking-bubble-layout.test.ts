import { describe, expect, it } from 'vitest'
import { bubblePlacementForSeat, shouldKeepBubbleOpen } from '../thinking-bubble-layout'

describe('thinking bubble layout', () => {
  it('keeps lower table bubbles above their own seats to avoid bottom overlap', () => {
    expect(bubblePlacementForSeat(0)).toBe('top')
    expect(bubblePlacementForSeat(1)).toBe('top-start')
    expect(bubblePlacementForSeat(5)).toBe('top-end')
  })

  it('keeps upper table bubbles below their own seats', () => {
    expect(bubblePlacementForSeat(2)).toBe('bottom-start')
    expect(bubblePlacementForSeat(3)).toBe('bottom')
    expect(bubblePlacementForSeat(4)).toBe('bottom-end')
  })

  it('closes stale or finalized bubbles instead of keeping old text visible', () => {
    expect(shouldKeepBubbleOpen({ text: 'thinking', visible: true, lastUpdatedAt: 1_000, now: 2_000 })).toBe(true)
    expect(shouldKeepBubbleOpen({ text: 'thinking', visible: true, lastUpdatedAt: 1_000, now: 7_000 })).toBe(false)
    expect(shouldKeepBubbleOpen({ text: '', visible: true, lastUpdatedAt: 1_000, now: 2_000 })).toBe(false)
  })
})
