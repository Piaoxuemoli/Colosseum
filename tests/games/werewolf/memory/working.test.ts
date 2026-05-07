import { describe, expect, it } from 'vitest'
import {
  initWorkingMemory,
  mergeBeliefUpdate,
  updateWorkingMemory,
} from '@/games/werewolf/memory/working'
import type { GameEvent } from '@/lib/core/types'

function event(partial: Partial<GameEvent>): GameEvent {
  return {
    id: partial.id ?? 'evt',
    matchId: partial.matchId ?? 'match_1',
    gameType: 'werewolf',
    seq: partial.seq ?? 1,
    occurredAt: partial.occurredAt ?? '2026-05-07T10:00:00.000Z',
    kind: partial.kind ?? 'werewolf/speak',
    actorAgentId: partial.actorAgentId ?? null,
    payload: partial.payload ?? {},
    visibility: partial.visibility ?? 'public',
    restrictedTo: partial.restrictedTo ?? null,
  }
}

describe('updateWorkingMemory', () => {
  it('picks up own role + wolf teammates on match-start (for a wolf observer)', () => {
    const m = initWorkingMemory('match_1', 'w1')
    const e = event({
      kind: 'werewolf/match-start',
      actorAgentId: null,
      payload: {
        roleAssignments: { w1: 'werewolf', w2: 'werewolf', s: 'seer', wi: 'witch', v1: 'villager', v2: 'villager' },
        teammates: ['w2'],
      },
      visibility: 'role-restricted',
      restrictedTo: ['w1', 'w2'],
    })
    const next = updateWorkingMemory(m, e)
    expect(next.ownRole).toBe('werewolf')
    expect(next.ownPrivateEvidence.werewolfTeammates).toEqual(['w2'])
  })

  it('drops role-restricted event not addressed to observer', () => {
    const m = initWorkingMemory('m1', 'v1')
    const e = event({
      kind: 'werewolf/werewolfKill',
      visibility: 'role-restricted',
      restrictedTo: ['w1', 'w2'],
      actorAgentId: 'w1',
      payload: { targetId: 'v1' },
    })
    const next = updateWorkingMemory(m, e)
    expect(next).toBe(m)
  })

  it('appends public speeches to speechLog', () => {
    const m = initWorkingMemory('m1', 'v1')
    const e = event({
      kind: 'werewolf/speak',
      actorAgentId: 'v2',
      payload: { day: 1, content: 'i think w1 is suspicious' },
      visibility: 'public',
    })
    const next = updateWorkingMemory(m, e)
    expect(next.speechLog).toHaveLength(1)
    expect(next.speechLog[0].agentId).toBe('v2')
  })

  it('captures seer check results ONLY for seer observer', () => {
    const seer = { ...initWorkingMemory('m1', 's'), ownRole: 'seer' as const }
    const e = event({
      kind: 'werewolf/seerCheck',
      actorAgentId: 's',
      visibility: 'role-restricted',
      restrictedTo: ['s'],
      payload: { day: 1, targetId: 'w1', role: 'werewolf' },
    })
    const next = updateWorkingMemory(seer, e)
    expect(next.ownPrivateEvidence.seerChecks).toHaveLength(1)

    // A villager observer (who, hypothetically, got the event routed in error)
    // should not mutate their evidence either.
    const villager = initWorkingMemory('m1', 'v1')
    const next2 = updateWorkingMemory(villager, {
      ...e,
      restrictedTo: ['v1'], // spoof routing
    })
    // ownRole never set → no ingest
    expect(next2.ownPrivateEvidence.seerChecks).toBeUndefined()
  })

  it('records witch potion usage for witch observer', () => {
    const witch = {
      ...initWorkingMemory('m1', 'wi'),
      ownRole: 'witch' as const,
      ownPrivateEvidence: { witchPotions: { save: true, poison: true } },
    }
    let next = updateWorkingMemory(witch, event({
      kind: 'werewolf/witchSave',
      actorAgentId: 'wi',
      visibility: 'role-restricted',
      restrictedTo: ['wi'],
      payload: {},
    }))
    expect(next.ownPrivateEvidence.witchPotions?.save).toBe(false)
    next = updateWorkingMemory(next, event({
      kind: 'werewolf/witchPoison',
      actorAgentId: 'wi',
      visibility: 'role-restricted',
      restrictedTo: ['wi'],
      payload: { targetId: 'v1' },
    }))
    expect(next.ownPrivateEvidence.witchPotions?.poison).toBe(false)
  })

  it('adds execution deaths to deathLog', () => {
    const m = initWorkingMemory('m1', 'v1')
    const next = updateWorkingMemory(m, event({
      kind: 'werewolf/execute',
      payload: { day: 1, victimId: 'w2', cause: 'vote' },
    }))
    expect(next.deathLog).toEqual([{ day: 1, agentId: 'w2', cause: 'vote' }])
  })
})

describe('mergeBeliefUpdate', () => {
  it('fills missing fields from prior or uniform prior', () => {
    const current = {}
    const patch = {
      v1: { werewolf: 0.7, villager: 0.2, seer: 0.05, witch: 0.05 },
    }
    const merged = mergeBeliefUpdate(current, patch)
    expect(merged.v1.werewolf).toBe(0.7)
    expect(merged.v1.reasoning).toEqual([])
    expect(merged.v1.lastUpdatedAt.phase).toBe('init')
  })

  it('caps reasoning to last 3 entries', () => {
    const merged = mergeBeliefUpdate(
      {},
      { v1: { werewolf: 0.5, villager: 0.5, seer: 0, witch: 0, reasoning: ['a', 'b', 'c', 'd', 'e'] } },
    )
    expect(merged.v1.reasoning).toEqual(['c', 'd', 'e'])
  })
})
