import { describe, expect, it } from 'vitest'
import { fallbackNarrationForPhase, moderatorNarrationEvent } from '@/lib/orchestrator/werewolf-hooks'
import type { WerewolfState } from '@/games/werewolf/engine/types'

function state(phase: WerewolfState['phase'], day = 1, moderator: string | null = 'mod'): WerewolfState {
  return {
    day,
    phase,
    players: [],
    roleAssignments: {},
    moderatorAgentId: moderator,
    speechQueue: [],
    werewolfDiscussionQueue: [],
    currentActor: null,
    witchPotions: { save: true, poison: true },
    lastNightKilled: null,
    lastNightSaved: null,
    lastNightPoisoned: null,
    seerCheckResults: [],
    speechLog: [],
    voteLog: [],
    matchComplete: false,
    winner: null,
  }
}

describe('fallbackNarrationForPhase', () => {
  it('returns a phase-specific narration for each known phase', () => {
    for (const p of [
      'night/werewolfDiscussion',
      'night/werewolfKill',
      'night/seerCheck',
      'night/witchAction',
      'day/announce',
      'day/speak',
      'day/vote',
      'day/execute',
    ] as const) {
      expect(fallbackNarrationForPhase(p)).toMatch(/.+/)
    }
  })

  it('keeps narration within the 80-char budget', () => {
    for (const p of [
      'night/werewolfDiscussion',
      'day/announce',
      'day/execute',
    ] as const) {
      expect(fallbackNarrationForPhase(p).length).toBeLessThanOrEqual(80)
    }
  })
})

describe('moderatorNarrationEvent', () => {
  it('returns null when the phase did not change', () => {
    const prev = state('day/speak')
    const next = state('day/speak')
    expect(moderatorNarrationEvent(prev, next)).toBeNull()
  })

  it('emits a public werewolf/moderator-narrate event on phase change', () => {
    const prev = state('night/werewolfKill')
    const next = state('night/seerCheck')
    const ev = moderatorNarrationEvent(prev, next)
    expect(ev).not.toBeNull()
    expect(ev!.kind).toBe('werewolf/moderator-narrate')
    expect(ev!.visibility).toBe('public')
    expect(ev!.actorAgentId).toBe('mod')
    expect((ev!.payload as { upcomingPhase: string }).upcomingPhase).toBe('night/seerCheck')
    expect((ev!.payload as { narration: string }).narration.length).toBeGreaterThan(0)
  })

  it('includes day in payload + handles null moderator gracefully', () => {
    const prev = state('day/speak', 2, null)
    const next = state('day/vote', 2, null)
    const ev = moderatorNarrationEvent(prev, next)
    expect(ev).not.toBeNull()
    expect(ev!.actorAgentId).toBeNull()
    expect((ev!.payload as { day: number }).day).toBe(2)
  })

  it('skips narration once the match has already completed', () => {
    const prev = state('day/execute')
    const next = { ...state('day/execute'), matchComplete: true }
    expect(moderatorNarrationEvent(prev, next)).toBeNull()
  })
})
