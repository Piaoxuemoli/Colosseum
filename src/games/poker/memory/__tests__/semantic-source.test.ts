import { describe, expect, it } from 'vitest'
import { updateSemantic } from '../semantic'
import type { PokerEpisodicEntry } from '../episodic'

function episode(handNumber: number): PokerEpisodicEntry {
  return {
    handId: `match_1:hand:${handNumber}`,
    matchId: 'match_1',
    handNumber,
    observer: 'observer',
    target: 'target',
    observedActions: ['preflop:raise 4'],
    outcome: 'won',
    targetShowdownHand: null,
    summary: 'preflop:raise 4；本手盈利',
    tags: ['aggressive', 'won'],
    createdAt: new Date(0).toISOString(),
  }
}

describe('poker semantic source tracking', () => {
  it('tracks source episode and last updated match/hand', () => {
    const profile = updateSemantic(null, episode(3))

    expect(profile.handCount).toBe(1)
    expect(profile.lastUpdatedHandId).toBe('match_1:hand:3')
    expect(profile.lastUpdatedMatchId).toBe('match_1')
    expect(profile.sourceEpisodeIds).toEqual(['match_1:hand:3'])
  })

  it('does not count the same hand twice', () => {
    const first = updateSemantic(null, episode(3))
    const second = updateSemantic(first, episode(3))

    expect(second.handCount).toBe(1)
    expect(second.sourceEpisodeIds).toEqual(['match_1:hand:3'])
  })
})
