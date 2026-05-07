import { describe, expect, it } from 'vitest'
import { werewolfEngine } from '@/games/werewolf/engine/werewolf-engine'
import type { WerewolfAction, WerewolfState } from '@/games/werewolf/engine/types'

const agentIds = ['a', 'b', 'c', 'd', 'e', 'f']
const names = Object.fromEntries(agentIds.map((id) => [id, id.toUpperCase()]))

function init(seed = 1): WerewolfState {
  return werewolfEngine.createInitialState(
    { seed, agentNames: names, moderatorAgentId: 'mod' },
    agentIds,
  )
}

describe('werewolfEngine', () => {
  it('createInitialState yields a valid 6-player state', () => {
    const s = init(7)
    expect(s.players.length).toBe(6)
    expect(s.phase).toBe('night/werewolfDiscussion')
    expect(s.day).toBe(0)
    expect(Object.values(s.roleAssignments).filter((r) => r === 'werewolf').length).toBe(2)
    expect(s.currentActor).not.toBeNull()
    expect(s.moderatorAgentId).toBe('mod')
  })

  it('is deterministic under the same seed', () => {
    const a = init(42)
    const b = init(42)
    expect(a.roleAssignments).toEqual(b.roleAssignments)
  })

  it('currentActor returns the state currentActor', () => {
    const s = init(1)
    expect(werewolfEngine.currentActor(s)).toBe(s.currentActor)
  })

  it('applyAction(night/werewolfKill) advances past the werewolfKill phase', () => {
    let state = init(7)
    // force state into night/werewolfKill with a wolf as currentActor
    const wolf = Object.entries(state.roleAssignments).find(([, r]) => r === 'werewolf')![0]
    const villager = Object.entries(state.roleAssignments).find(([, r]) => r !== 'werewolf')![0]
    state = { ...state, phase: 'night/werewolfKill' as const, currentActor: wolf }

    const action: WerewolfAction = {
      type: 'night/werewolfKill',
      targetId: villager,
      reasoning: 'test',
    }
    const { nextState, events } = werewolfEngine.applyAction(state, wolf, action)
    expect(nextState.phase).toBe('night/seerCheck')
    expect(nextState.lastNightKilled).toBe(villager)
    expect(events.length).toBeGreaterThan(0)
    expect(events[0].kind).toBe('werewolf/werewolfKill')
    expect(events[0].visibility).toBe('role-restricted')
  })

  it('applyAction throws on invalid actions', () => {
    const state = init(7)
    const notWolf = Object.entries(state.roleAssignments).find(([, r]) => r !== 'werewolf')![0]
    expect(() =>
      werewolfEngine.applyAction(
        { ...state, phase: 'night/werewolfKill', currentActor: notWolf },
        notWolf,
        { type: 'night/werewolfKill', targetId: 'a', reasoning: 'x' },
      ),
    ).toThrow()
  })

  it('availableActions empty for non-current actor', () => {
    const state = init(1)
    const nonActor = agentIds.find((id) => id !== state.currentActor)!
    expect(werewolfEngine.availableActions(state, nonActor)).toEqual([])
  })

  it('boundary returns match-end on win transition', () => {
    const prev = { ...init(1), matchComplete: false } as WerewolfState
    const next = { ...prev, matchComplete: true, winner: 'werewolves' as const }
    expect(werewolfEngine.boundary(prev, next)).toBe('match-end')
  })

  it('finalize produces ranking with role/death info', () => {
    const s = init(1)
    const result = werewolfEngine.finalize(s)
    expect(result.ranking.length).toBe(6)
    expect(result.ranking[0].extra?.role).toBeDefined()
  })
})
