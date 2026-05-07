import { describe, expect, it } from 'vitest'
import { advancePhase } from '@/games/werewolf/engine/phase-machine'
import type { WerewolfState } from '@/games/werewolf/engine/types'
import { makeBaseState } from './_helpers'

describe('advancePhase', () => {
  it('night/werewolfKill -> night/seerCheck with seer as currentActor', () => {
    const s = { ...makeBaseState(), phase: 'night/werewolfKill' as const, currentActor: 'w1' }
    const next = advancePhase(s)
    expect(next.phase).toBe('night/seerCheck')
    expect(next.currentActor).toBe('s')
  })

  it('night/seerCheck -> night/witchAction', () => {
    const s = { ...makeBaseState(), phase: 'night/seerCheck' as const, currentActor: 's' }
    const next = advancePhase(s)
    expect(next.phase).toBe('night/witchAction')
    expect(next.currentActor).toBe('wi')
  })

  it('night/witchAction resolves deaths and enters day/speak (announce is collapsed)', () => {
    const s = {
      ...makeBaseState(),
      phase: 'night/witchAction' as const,
      currentActor: 'wi',
      lastNightKilled: 'v1',
    }
    const next = advancePhase(s)
    // day/announce is a non-actor phase and is collapsed into day/speak so
    // the orchestrator never sees a null currentActor mid-game.
    expect(next.phase).toBe('day/speak')
    expect(next.day).toBe(1)
    expect(next.currentActor).not.toBeNull()
    const v1 = next.players.find((p) => p.agentId === 'v1')!
    expect(v1.alive).toBe(false)
    expect(v1.deathCause).toBe('werewolfKill')
  })

  it('witch save nullifies the werewolf kill', () => {
    const s = {
      ...makeBaseState(),
      phase: 'night/witchAction' as const,
      lastNightKilled: 'v1',
      lastNightSaved: 'v1',
    }
    const next = advancePhase(s)
    const v1 = next.players.find((p) => p.agentId === 'v1')!
    expect(v1.alive).toBe(true)
  })

  it('witch poison kills an independent target (in addition to werewolf kill)', () => {
    const s = {
      ...makeBaseState(),
      phase: 'night/witchAction' as const,
      lastNightKilled: 'v1',
      lastNightPoisoned: 'v2',
    }
    const next = advancePhase(s)
    const v1 = next.players.find((p) => p.agentId === 'v1')!
    const v2 = next.players.find((p) => p.agentId === 'v2')!
    expect(v1.alive).toBe(false)
    expect(v2.alive).toBe(false)
    expect(v2.deathCause).toBe('witchPoison')
  })

  it('day/announce -> day/speak with full speech queue', () => {
    const s = { ...makeBaseState(), phase: 'day/announce' as const, day: 1 }
    const next = advancePhase(s)
    expect(next.phase).toBe('day/speak')
    expect(next.currentActor).toBe('w1') // first alive in seat order
    expect(next.speechQueue.length).toBe(5)
  })

  it('day/speak cycles currentActor through speechQueue then enters day/vote', () => {
    let s: WerewolfState = {
      ...makeBaseState(),
      phase: 'day/speak' as const,
      day: 1,
      currentActor: 'v1',
      speechQueue: ['v2'],
    }
    s = advancePhase(s)
    expect(s.phase).toBe('day/speak')
    expect(s.currentActor).toBe('v2')
    expect(s.speechQueue).toEqual([])

    s = advancePhase(s)
    expect(s.phase).toBe('day/vote')
  })

  it('day/execute resolves top vote + advances to next night', () => {
    const s = {
      ...makeBaseState(),
      phase: 'day/execute' as const,
      day: 1,
      voteLog: [
        { day: 1, voter: 'w1', target: 'v2', at: 0 },
        { day: 1, voter: 'w2', target: 'v2', at: 0 },
        { day: 1, voter: 's', target: 'w1', at: 0 },
        { day: 1, voter: 'v1', target: 'v2', at: 0 },
      ],
    }
    const next = advancePhase(s)
    const v2 = next.players.find((p) => p.agentId === 'v2')!
    expect(v2.alive).toBe(false)
    expect(v2.deathCause).toBe('vote')
    expect(next.phase).toBe('night/werewolfDiscussion')
    expect(next.werewolfDiscussionQueue.length).toBeGreaterThan(0)
  })

  it('a tied vote results in nobody executed', () => {
    const s = {
      ...makeBaseState(),
      phase: 'day/execute' as const,
      day: 1,
      voteLog: [
        { day: 1, voter: 'w1', target: 'v2', at: 0 },
        { day: 1, voter: 's', target: 'v1', at: 0 },
      ],
    }
    const next = advancePhase(s)
    expect(next.players.every((p) => p.alive)).toBe(true)
    expect(next.phase).toBe('night/werewolfDiscussion')
  })

  it('marks matchComplete when advance triggers a win', () => {
    const base = makeBaseState()
    const s = {
      ...base,
      phase: 'night/witchAction' as const,
      lastNightKilled: 's',
      lastNightPoisoned: 'wi',
      // after killing s + poisoning wi, alive = { w1, w2, v1, v2 }, wolves=2 villagers=2 -> wolves win
      players: base.players.map((p) =>
        p.agentId === 'v1' ? { ...p, alive: false, deathDay: 0, deathCause: 'vote' as const } : p,
      ),
    }
    const next = advancePhase(s)
    expect(next.matchComplete).toBe(true)
    expect(next.winner).toBe('werewolves')
  })

  it('witchAction-triggered win keeps phase at night/witchAction (not day/announce)', () => {
    const base = makeBaseState()
    const s = {
      ...base,
      phase: 'night/witchAction' as const,
      lastNightKilled: 's',
      lastNightPoisoned: 'wi',
      players: base.players.map((p) =>
        p.agentId === 'v1' ? { ...p, alive: false, deathDay: 0, deathCause: 'vote' as const } : p,
      ),
    }
    const next = advancePhase(s)
    expect(next.matchComplete).toBe(true)
    expect(next.phase).toBe('night/witchAction')
    expect(next.currentActor).toBeNull()
    expect(next.day).toBe(0)
  })

  it('day/execute-triggered win keeps phase at day/execute (not night/werewolfDiscussion)', () => {
    const base = makeBaseState()
    // Set up so only 1 wolf remains; voting out that wolf triggers villager win
    const s = {
      ...base,
      phase: 'day/execute' as const,
      day: 1,
      players: base.players.map((p) =>
        p.agentId === 'w2' ? { ...p, alive: false, deathDay: 1, deathCause: 'vote' as const } : p,
      ),
      voteLog: [
        { day: 1, voter: 's', target: 'w1', at: 0 },
        { day: 1, voter: 'wi', target: 'w1', at: 0 },
        { day: 1, voter: 'v1', target: 'w1', at: 0 },
      ],
    }
    const next = advancePhase(s)
    expect(next.matchComplete).toBe(true)
    expect(next.winner).toBe('villagers')
    expect(next.phase).toBe('day/execute')
    expect(next.currentActor).toBeNull()
  })

  it('day/vote advances directly into next night with a non-null currentActor', () => {
    // Live code-path: the last voter's action lands in day/vote, then
    // advancePhase collapses day/execute so the GM never sees a null actor.
    const s = {
      ...makeBaseState(),
      phase: 'day/vote' as const,
      day: 1,
      voteLog: [
        { day: 1, voter: 'w1', target: 'v2', at: 0 },
        { day: 1, voter: 'w2', target: 'v2', at: 0 },
        { day: 1, voter: 's', target: 'v2', at: 0 },
        { day: 1, voter: 'v1', target: 'v2', at: 0 },
      ],
    }
    const next = advancePhase(s)
    expect(next.phase).toBe('night/werewolfDiscussion')
    expect(next.currentActor).not.toBeNull()
    const v2 = next.players.find((p) => p.agentId === 'v2')!
    expect(v2.alive).toBe(false)
    expect(v2.deathCause).toBe('vote')
  })

  it('day/vote settles with winner (no remaining wolves) and phase is parked on day/execute', () => {
    const base = makeBaseState()
    const s = {
      ...base,
      phase: 'day/vote' as const,
      day: 1,
      players: base.players.map((p) =>
        p.agentId === 'w2' ? { ...p, alive: false, deathDay: 1, deathCause: 'vote' as const } : p,
      ),
      voteLog: [
        { day: 1, voter: 's', target: 'w1', at: 0 },
        { day: 1, voter: 'wi', target: 'w1', at: 0 },
        { day: 1, voter: 'v1', target: 'w1', at: 0 },
      ],
    }
    const next = advancePhase(s)
    expect(next.matchComplete).toBe(true)
    expect(next.winner).toBe('villagers')
    expect(next.phase).toBe('day/execute')
    expect(next.currentActor).toBeNull()
  })
})
