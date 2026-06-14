import { describe, expect, it } from 'vitest'
import { observedCountLabel } from '../impression-format'

describe('impression format', () => {
  it('uses poker handCount as the displayed observed count', () => {
    expect(observedCountLabel('poker', { handCount: 52 }, 3)).toBe('52 手')
  })

  it('keeps werewolf semantic counts as games', () => {
    expect(observedCountLabel('werewolf', {}, 3)).toBe('3 局')
  })
})
