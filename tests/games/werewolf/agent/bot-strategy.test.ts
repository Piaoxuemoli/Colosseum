import { describe, expect, it } from 'vitest'
import { WerewolfBotStrategy } from '@/games/werewolf/agent/bot-strategy'
import type { WerewolfState } from '@/games/werewolf/engine/types'
import { makeBaseState } from '../engine/_helpers'

function withPhase(phase: WerewolfState['phase'], currentActor: string): WerewolfState {
  return { ...makeBaseState(), phase, currentActor }
}

// Deterministic RNG so we can assert target selections stably.
function fixedRng(values: number[]): () => number {
  let i = 0
  return () => values[i++ % values.length]
}

describe('WerewolfBotStrategy', () => {
  it('werewolfKill: picks a non-werewolf alive target', () => {
    const bot = new WerewolfBotStrategy(fixedRng([0]))
    const state = withPhase('night/werewolfKill', 'w1')
    const a = bot.decide(state, []) as { type: string; targetId: string }
    expect(a.type).toBe('night/werewolfKill')
    expect(['s', 'wi', 'v1', 'v2']).toContain(a.targetId)
    expect(a.targetId).not.toBe('w1')
    expect(a.targetId).not.toBe('w2')
  })

  it('seerCheck: avoids self and previously-checked targets', () => {
    const bot = new WerewolfBotStrategy(fixedRng([0]))
    const state = {
      ...withPhase('night/seerCheck', 's'),
      seerCheckResults: [{ day: 0, targetId: 'w1', role: 'werewolf' as const }],
    }
    const a = bot.decide(state, []) as { type: string; targetId: string }
    expect(a.type).toBe('night/seerCheck')
    expect(a.targetId).not.toBe('s')
    expect(a.targetId).not.toBe('w1')
  })

  it('witchAction: always skips potions (target=null)', () => {
    const bot = new WerewolfBotStrategy()
    const state = withPhase('night/witchAction', 'wi')
    const a = bot.decide(state, []) as { type: string; targetId: string | null }
    expect(a.type).toBe('night/witchPoison')
    expect(a.targetId).toBeNull()
  })

  it('day/speak: returns a stock observing phrase', () => {
    const bot = new WerewolfBotStrategy()
    const state = withPhase('day/speak', 'v1')
    const a = bot.decide(state, []) as { type: string; content: string }
    expect(a.type).toBe('day/speak')
    expect(a.content.length).toBeLessThanOrEqual(200)
  })

  it('werewolfDiscussion: werewolf speaks a stock phrase', () => {
    const bot = new WerewolfBotStrategy()
    const state = withPhase('night/werewolfDiscussion', 'w1')
    const a = bot.decide(state, []) as { type: string; content: string }
    expect(a.type).toBe('day/speak')
    expect(typeof a.content).toBe('string')
  })

  it('day/vote: abstains when rng < 0.3', () => {
    const bot = new WerewolfBotStrategy(fixedRng([0.1]))
    const state = withPhase('day/vote', 'v1')
    const a = bot.decide(state, []) as { type: string; targetId: string | null }
    expect(a.type).toBe('day/vote')
    expect(a.targetId).toBeNull()
  })

  it('day/vote: picks a non-self alive target when rng >= 0.3', () => {
    const bot = new WerewolfBotStrategy(fixedRng([0.5, 0]))
    const state = withPhase('day/vote', 'v1')
    const a = bot.decide(state, []) as { type: string; targetId: string | null }
    expect(a.targetId).not.toBe(null)
    expect(a.targetId).not.toBe('v1')
  })

  it('degrades gracefully when currentActor is null', () => {
    const bot = new WerewolfBotStrategy()
    const state = { ...makeBaseState(), currentActor: null }
    const a = bot.decide(state, []) as { type: string }
    expect(a.type).toBe('day/speak')
  })
})
