import { describe, expect, it } from 'vitest'
import { synthesizeEpisodic } from '@/games/werewolf/memory/episodic'
import { initWorkingMemory } from '@/games/werewolf/memory/working'
import type { WerewolfState } from '@/games/werewolf/engine/types'
import { makeBaseState } from '../engine/_helpers'

function finalState(winner: 'werewolves' | 'villagers' | 'tie', day = 3): WerewolfState {
  return {
    ...makeBaseState(),
    day,
    phase: winner === 'werewolves' ? 'day/execute' : 'night/witchAction',
    matchComplete: true,
    winner,
  }
}

describe('synthesizeEpisodic', () => {
  it('outcome: villager observer in villager-winning match -> won', () => {
    const working = initWorkingMemory('m1', 'v1')
    const e = synthesizeEpisodic({
      working,
      finalState: finalState('villagers'),
      observerAgentId: 'v1',
      matchId: 'm1',
    })
    expect(e.ownOutcome).toBe('won')
    expect(e.winnerFaction).toBe('villagers')
  })

  it('outcome: werewolf observer in villager-winning match -> lost', () => {
    const working = initWorkingMemory('m1', 'w1')
    const e = synthesizeEpisodic({
      working,
      finalState: finalState('villagers'),
      observerAgentId: 'w1',
      matchId: 'm1',
    })
    expect(e.ownOutcome).toBe('lost')
  })

  it('beliefAccuracy: correctness + calibration reflect prior beliefs', () => {
    const working = {
      ...initWorkingMemory('m1', 'v1'),
      beliefState: {
        w1: {
          werewolf: 0.9,
          villager: 0.05,
          seer: 0.03,
          witch: 0.02,
          reasoning: [],
          lastUpdatedAt: { day: 2, phase: 'day/speak' },
        },
        v2: {
          werewolf: 0.1,
          villager: 0.7,
          seer: 0.1,
          witch: 0.1,
          reasoning: [],
          lastUpdatedAt: { day: 2, phase: 'day/speak' },
        },
      },
    }
    const e = synthesizeEpisodic({
      working,
      finalState: finalState('villagers'),
      observerAgentId: 'v1',
      matchId: 'm1',
    })
    // w1's actual role is 'werewolf' in makeBaseState; observer correctly tagged it
    expect(e.beliefAccuracy.w1.correct).toBe(true)
    expect(e.beliefAccuracy.w1.confidenceCalibration).toBe(0.9)
    expect(e.beliefAccuracy.v2.correct).toBe(true)
    // observer skipped
    expect(e.beliefAccuracy.v1).toBeUndefined()
  })

  it('tie outcome collapses to tie', () => {
    const e = synthesizeEpisodic({
      working: initWorkingMemory('m1', 'v1'),
      finalState: finalState('tie', 40),
      observerAgentId: 'v1',
      matchId: 'm1',
    })
    expect(e.ownOutcome).toBe('tie')
    expect(e.winnerFaction).toBe('tie')
  })

  it('summary is ≤150 chars', () => {
    const e = synthesizeEpisodic({
      working: initWorkingMemory('m1', 'v1'),
      finalState: finalState('villagers', 2),
      observerAgentId: 'v1',
      matchId: 'm1',
    })
    expect(e.summary.length).toBeLessThanOrEqual(150)
  })
})
