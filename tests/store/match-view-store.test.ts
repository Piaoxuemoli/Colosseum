import { beforeEach, describe, expect, it } from 'vitest'
import { useMatchViewStore } from '@/store/match-view-store'
import type { GameEvent } from '@/lib/core/types'

function event(input: Partial<GameEvent>): GameEvent {
  return {
    id: 'e1',
    matchId: 'm',
    gameType: 'poker',
    seq: 1,
    occurredAt: '2026-05-06T00:00:00Z',
    kind: 'poker/match-start',
    actorAgentId: null,
    payload: {},
    visibility: 'public',
    restrictedTo: null,
    ...input,
  }
}

describe('match-view-store', () => {
  beforeEach(() => {
    useMatchViewStore.getState().reset()
  })

  it('ingest event appends to list', () => {
    useMatchViewStore.getState().ingestEvent(event({ id: 'e1' }))
    expect(useMatchViewStore.getState().events.length).toBe(1)
  })

  it('thinking delta accumulates per agent', () => {
    useMatchViewStore.getState().appendThinking('agt_1', 'hello ')
    useMatchViewStore.getState().appendThinking('agt_1', 'world')
    expect(useMatchViewStore.getState().thinkingByAgent.agt_1).toBe('hello world')
  })

  it('clearThinking removes agent entry', () => {
    useMatchViewStore.getState().appendThinking('agt_1', 'x')
    useMatchViewStore.getState().clearThinking('agt_1')
    expect(useMatchViewStore.getState().thinkingByAgent.agt_1).toBeUndefined()
  })

  it('updates pot and player chips from action event', () => {
    useMatchViewStore.getState().init({
      matchId: 'm',
      players: [
        {
          agentId: 'agt_1',
          displayName: 'A',
          avatarEmoji: 'A',
          seatIndex: 0,
          chips: 200,
          currentBet: 0,
          status: 'active',
          holeCards: [],
        },
      ],
    })
    useMatchViewStore.getState().ingestEvent(
      event({
        kind: 'poker/action',
        actorAgentId: 'agt_1',
        payload: { type: 'bet', amount: 10 },
      }),
    )

    const state = useMatchViewStore.getState()
    expect(state.pot).toBe(10)
    expect(state.players[0].chips).toBe(190)
  })

  it('records explicit chip snapshots', () => {
    const store = useMatchViewStore.getState()
    store.recordHandSnapshot(1, { a: 100, b: 150 })
    store.recordHandSnapshot(2, { a: 90, b: 160 })

    expect(useMatchViewStore.getState().chipHistory).toHaveLength(2)
    expect(useMatchViewStore.getState().chipHistory[1].chips.b).toBe(160)
  })

  it('increments error count on agent_error event', () => {
    const store = useMatchViewStore.getState()
    store.ingestEvent(event({ kind: 'agent_error' }))
    store.ingestEvent(event({ kind: 'agent_error' }))

    expect(useMatchViewStore.getState().errorCount).toBe(2)
  })

  it('sets status to settled on match-end', () => {
    useMatchViewStore.getState().ingestEvent(event({ kind: 'poker/match-end', payload: { winnerId: 'agt_1' } }))

    expect(useMatchViewStore.getState().status).toBe('settled')
    expect(useMatchViewStore.getState().matchComplete).toBe(true)
  })

  it('sets status to settled on legacy settlement events', () => {
    useMatchViewStore.getState().ingestEvent(event({ kind: 'match_end' }))

    expect(useMatchViewStore.getState().status).toBe('settled')
    expect(useMatchViewStore.getState().matchComplete).toBe(true)
  })
})
