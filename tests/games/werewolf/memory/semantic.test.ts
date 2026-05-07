import { describe, expect, it } from 'vitest'
import {
  defaultSemanticProfile,
  updateSemantic,
} from '@/games/werewolf/memory/semantic'
import type { WerewolfEpisodicEntry } from '@/games/werewolf/memory/types'

function episodic(partial: Partial<WerewolfEpisodicEntry> = {}): WerewolfEpisodicEntry {
  return {
    matchId: 'm1',
    observerAgentId: 'v1',
    actualRoles: {
      v1: 'villager',
      w1: 'werewolf',
      s: 'seer',
    },
    winnerFaction: 'villagers',
    ownOutcome: 'won',
    beliefAccuracy: {},
    keyMoments: [],
    summary: 'villagers won',
    tags: ['won'],
    ...partial,
  }
}

describe('updateSemantic', () => {
  it('starts with a default profile when prior is null', () => {
    const e = episodic()
    const p = updateSemantic(null, e, 'w1')
    expect(p.gamesObserved).toBe(1)
    expect(p.observerAgentId).toBe('v1')
    expect(p.targetAgentId).toBe('w1')
  })

  it('increments win-loss record for the target"s actual role', () => {
    // target w1 is werewolf; villagers won this match -> target lost
    const p = updateSemantic(null, episodic(), 'w1')
    expect(p.winLossRecord.asWerewolf).toEqual([0, 1])
  })

  it('counts a werewolf win correctly', () => {
    const p = updateSemantic(null, episodic({ winnerFaction: 'werewolves', ownOutcome: 'lost' }), 'w1')
    expect(p.winLossRecord.asWerewolf).toEqual([1, 0])
  })

  it('nudges actingSkill up when observer was wrong about target', () => {
    const prior = defaultSemanticProfile('v1', 'w1')
    const e = episodic({
      beliefAccuracy: {
        w1: {
          finalBelief: { werewolf: 0.1, villager: 0.7, seer: 0.1, witch: 0.1 },
          actualRole: 'werewolf',
          mostLikely: 'villager',
          correct: false,
          confidenceCalibration: 0.1,
        },
      },
    })
    const p = updateSemantic(prior, e, 'w1')
    expect(p.actingSkill).toBeGreaterThan(prior.actingSkill)
  })

  it('caps acting/reasoning scores to [1,10]', () => {
    let p = defaultSemanticProfile('v1', 'w1')
    p = { ...p, actingSkill: 9.9, reasoningDepth: 9.95 }
    const e = episodic({
      beliefAccuracy: {
        w1: {
          finalBelief: { werewolf: 0.05, villager: 0.8, seer: 0.1, witch: 0.05 },
          actualRole: 'werewolf',
          mostLikely: 'villager',
          correct: false,
          confidenceCalibration: 0.05,
        },
      },
    })
    const updated = updateSemantic(p, e, 'w1')
    expect(updated.actingSkill).toBeLessThanOrEqual(10)
    expect(updated.reasoningDepth).toBeLessThanOrEqual(10)
  })

  it('no-ops stats when target absent from match but still counts observation', () => {
    const p = updateSemantic(null, episodic(), 'stranger')
    expect(p.gamesObserved).toBe(1)
    expect(p.winLossRecord.asWerewolf).toEqual([0, 0])
  })
})
