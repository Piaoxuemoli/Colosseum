import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GameEvent } from '@/lib/core/types'
import { useMatchViewStore } from '@/store/match-view-store'
import { useReplayStore } from '@/store/replay-store'

function evt(partial: Partial<GameEvent> & { seq: number }): GameEvent {
  return {
    id: `e-${partial.seq}`,
    matchId: 'm',
    gameType: 'poker',
    occurredAt: '2026-05-07T00:00:00Z',
    kind: 'agent_error',
    actorAgentId: null,
    payload: {},
    visibility: 'public',
    restrictedTo: null,
    ...partial,
  }
}

describe('replay-store', () => {
  beforeEach(() => {
    useReplayStore.getState().reset()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('load clears match-view-store and stores events without playing', () => {
    useMatchViewStore.getState().ingestEvent(evt({ seq: 99, kind: 'agent_error' }))
    expect(useMatchViewStore.getState().errorCount).toBe(1)

    useReplayStore.getState().load([evt({ seq: 1 }), evt({ seq: 2 })])
    // reset was called on match-view-store
    expect(useMatchViewStore.getState().errorCount).toBe(0)
    expect(useReplayStore.getState().events).toHaveLength(2)
    expect(useReplayStore.getState().cursor).toBe(0)
    expect(useReplayStore.getState().isPlaying).toBe(false)
  })

  it('stepForward advances cursor by one and feeds the match-view-store', () => {
    useReplayStore.getState().load([
      evt({ seq: 1, kind: 'agent_error' }),
      evt({ seq: 2, kind: 'agent_error' }),
    ])

    useReplayStore.getState().stepForward()
    expect(useReplayStore.getState().cursor).toBe(1)
    expect(useMatchViewStore.getState().errorCount).toBe(1)
  })

  it('stepForward at the end auto-pauses and does not overshoot', () => {
    useReplayStore.getState().load([evt({ seq: 1 })])
    useReplayStore.getState().stepForward()
    useReplayStore.getState().play()
    useReplayStore.getState().stepForward() // beyond end
    expect(useReplayStore.getState().cursor).toBe(1)
    expect(useReplayStore.getState().isPlaying).toBe(false)
  })

  it('stepBackward reduces cursor by one via replay from scratch', () => {
    useReplayStore.getState().load([
      evt({ seq: 1, kind: 'agent_error' }),
      evt({ seq: 2, kind: 'agent_error' }),
    ])
    useReplayStore.getState().stepForward()
    useReplayStore.getState().stepForward()
    expect(useMatchViewStore.getState().errorCount).toBe(2)

    useReplayStore.getState().stepBackward()
    expect(useReplayStore.getState().cursor).toBe(1)
    expect(useMatchViewStore.getState().errorCount).toBe(1)
  })

  it('seekTo clamps to [0, events.length] and replays from scratch', () => {
    useReplayStore.getState().load([
      evt({ seq: 1, kind: 'agent_error' }),
      evt({ seq: 2, kind: 'agent_error' }),
      evt({ seq: 3, kind: 'agent_error' }),
    ])
    useReplayStore.getState().seekTo(2)
    expect(useReplayStore.getState().cursor).toBe(2)
    expect(useMatchViewStore.getState().errorCount).toBe(2)

    useReplayStore.getState().seekTo(-10)
    expect(useReplayStore.getState().cursor).toBe(0)
    expect(useMatchViewStore.getState().errorCount).toBe(0)

    useReplayStore.getState().seekTo(9999)
    expect(useReplayStore.getState().cursor).toBe(3)
    expect(useMatchViewStore.getState().errorCount).toBe(3)
  })

  it('setSpeed only accepts positive speeds', () => {
    useReplayStore.getState().setSpeed(2)
    expect(useReplayStore.getState().speed).toBe(2)
    useReplayStore.getState().setSpeed(-1)
    expect(useReplayStore.getState().speed).toBe(2) // unchanged
    useReplayStore.getState().setSpeed(0)
    expect(useReplayStore.getState().speed).toBe(2) // unchanged
  })

  it('play + tickOne advances cursor one event at a time', () => {
    useReplayStore.getState().load([
      evt({ seq: 1, kind: 'agent_error' }),
      evt({ seq: 2, kind: 'agent_error' }),
    ])
    useReplayStore.getState().play()
    expect(useReplayStore.getState().isPlaying).toBe(true)
    useReplayStore.getState().tickOne()
    useReplayStore.getState().tickOne()
    expect(useReplayStore.getState().cursor).toBe(2)
    expect(useReplayStore.getState().isPlaying).toBe(false) // end reached
  })

  it('load with seatSetup re-applies players on every seek (regression)', () => {
    const seatSetup = {
      matchId: 'm',
      players: [
        {
          agentId: 'a',
          displayName: 'Alice',
          avatarEmoji: '🃏',
          seatIndex: 0,
          chips: 200,
          currentBet: 0,
          status: 'active' as const,
          holeCards: [],
        },
      ],
    }

    useReplayStore.getState().load(
      [
        evt({ seq: 1, kind: 'agent_error' }),
        evt({ seq: 2, kind: 'agent_error' }),
      ],
      seatSetup,
    )
    expect(useMatchViewStore.getState().players).toHaveLength(1)

    useReplayStore.getState().seekTo(2)
    // seats must survive the reset-and-replay trip
    expect(useMatchViewStore.getState().players).toHaveLength(1)
    expect(useMatchViewStore.getState().players[0].displayName).toBe('Alice')

    useReplayStore.getState().stepBackward()
    expect(useMatchViewStore.getState().players).toHaveLength(1)
  })
})
