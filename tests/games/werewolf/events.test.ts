import { describe, expect, it } from 'vitest'
import {
  isWerewolfEventKind,
  visibilityForKind,
  WEREWOLF_EVENT_KINDS,
} from '@/games/werewolf/events'

describe('werewolf events', () => {
  it('werewolfDiscuss / werewolfKill are restricted to the werewolf set', () => {
    const werewolfIds = ['w1', 'w2']
    expect(visibilityForKind('werewolf/werewolfDiscuss', { actorAgentId: 'w1', werewolfIds })).toEqual({
      visibility: 'role-restricted',
      restrictedTo: werewolfIds,
    })
    expect(visibilityForKind('werewolf/werewolfKill', { actorAgentId: 'w1', werewolfIds })).toEqual({
      visibility: 'role-restricted',
      restrictedTo: werewolfIds,
    })
  })

  it('seerCheck / witchSave / witchPoison are restricted to the actor only', () => {
    const werewolfIds = ['w1', 'w2']
    expect(visibilityForKind('werewolf/seerCheck', { actorAgentId: 's', werewolfIds })).toEqual({
      visibility: 'role-restricted',
      restrictedTo: ['s'],
    })
    expect(visibilityForKind('werewolf/witchSave', { actorAgentId: 'wi', werewolfIds })).toEqual({
      visibility: 'role-restricted',
      restrictedTo: ['wi'],
    })
    expect(visibilityForKind('werewolf/witchPoison', { actorAgentId: 'wi', werewolfIds })).toEqual({
      visibility: 'role-restricted',
      restrictedTo: ['wi'],
    })
  })

  it('public events (speak / vote / execute / day-announce / game-end) broadcast to all', () => {
    for (const kind of [
      'werewolf/speak',
      'werewolf/vote',
      'werewolf/execute',
      'werewolf/day-announce',
      'werewolf/game-end',
      'werewolf/moderator-narrate',
      'werewolf/match-start',
      'werewolf/phase-enter',
    ] as const) {
      expect(visibilityForKind(kind, { actorAgentId: 'x', werewolfIds: [] })).toEqual({
        visibility: 'public',
        restrictedTo: null,
      })
    }
  })

  it('actor-restricted events with null actor fall back to empty restrictedTo', () => {
    expect(
      visibilityForKind('werewolf/seerCheck', { actorAgentId: null, werewolfIds: [] }),
    ).toEqual({
      visibility: 'role-restricted',
      restrictedTo: [],
    })
  })

  it('isWerewolfEventKind narrows correctly', () => {
    expect(isWerewolfEventKind('werewolf/speak')).toBe(true)
    expect(isWerewolfEventKind('werewolf/unknown')).toBe(false)
    expect(isWerewolfEventKind('poker/bet')).toBe(false)
  })

  it('WEREWOLF_EVENT_KINDS list is non-empty and unique', () => {
    const set = new Set(WEREWOLF_EVENT_KINDS)
    expect(set.size).toBe(WEREWOLF_EVENT_KINDS.length)
    expect(WEREWOLF_EVENT_KINDS.length).toBeGreaterThanOrEqual(13)
  })
})
