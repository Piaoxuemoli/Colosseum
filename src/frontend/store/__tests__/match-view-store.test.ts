import { beforeEach, describe, expect, it } from 'vitest'
import { deriveMatchView, useMatchViewStore, type PokerUiPlayer } from '../match-view-store'
import type { GameEvent } from '@/platform/core/types'

function event(kind: string, payload: Record<string, unknown>, seq = 1, actorAgentId: string | null = null): GameEvent {
  return {
    id: `evt_${seq}`,
    matchId: 'match_1',
    gameType: 'poker',
    seq,
    occurredAt: new Date(0).toISOString(),
    kind,
    actorAgentId,
    payload,
    visibility: 'public',
    restrictedTo: null,
  }
}

const players: PokerUiPlayer[] = [
  {
    agentId: 'agent-a',
    displayName: 'Agent A',
    avatarEmoji: 'A',
    seatIndex: 0,
    chips: 200,
    currentBet: 0,
    status: 'active',
    holeCards: [],
  },
  {
    agentId: 'agent-b',
    displayName: 'Agent B',
    avatarEmoji: 'B',
    seatIndex: 1,
    chips: 200,
    currentBet: 0,
    status: 'active',
    holeCards: [],
  },
]

describe('match view store hand number replay', () => {
  beforeEach(() => {
    useMatchViewStore.getState().reset()
    useMatchViewStore.getState().init({ matchId: 'match_1', players })
  })

  it('uses poker hand-start as an authoritative hand number during refresh replay', () => {
    useMatchViewStore.getState().ingestEvent(event('poker/hand-start', { handNumber: 52 }))

    expect(useMatchViewStore.getState().handNumber).toBe(52)
    expect(useMatchViewStore.getState().events.at(-1)?.handNumberAt).toBe(52)
  })

  it('derives the same projection as incremental store ingestion', () => {
    const events = [
      event('poker/state', {
        phase: 'preflop',
        handNumber: 1,
        currentActor: 'agent-a',
        players: [
          { id: 'agent-a', seatIndex: 0, chips: 200, currentBet: 0, status: 'active', holeCards: [] },
          { id: 'agent-b', seatIndex: 1, chips: 200, currentBet: 0, status: 'active', holeCards: [] },
        ],
        pot: 0,
        streetPots: { preflop: 0, flop: 0, turn: 0, river: 0 },
        sidePots: [],
      }, 1),
      event('poker/action', { type: 'bet', amount: 4 }, 2, 'agent-a'),
      event('poker/pot-award', { potAmount: 4, winnerIds: ['agent-a'] }, 3),
      event('poker/hand-start', { handNumber: 2 }, 4),
    ]

    for (const item of events) useMatchViewStore.getState().ingestEvent(item)
    const incremental = useMatchViewStore.getState()
    const derived = deriveMatchView(events, { matchId: 'match_1', players })

    expect(derived.handNumber).toBe(incremental.handNumber)
    expect(derived.phase).toBe(incremental.phase)
    expect(derived.chipHistory).toEqual(incremental.chipHistory)
    expect(derived.events.map((item) => item.handNumberAt)).toEqual(incremental.events.map((item) => item.handNumberAt))
    expect(derived.players.map((item) => ({ id: item.agentId, chips: item.chips, bet: item.currentBet }))).toEqual(
      incremental.players.map((item) => ({ id: item.agentId, chips: item.chips, bet: item.currentBet })),
    )
  })
})
