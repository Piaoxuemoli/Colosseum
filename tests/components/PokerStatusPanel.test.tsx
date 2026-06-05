import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PokerStatusPanel } from '@/components/match/PokerStatusPanel'
import { ActionLog } from '@/components/match/ActionLog'
import { FinishAfterHandButton } from '@/components/match/FinishAfterHandButton'
import { useMatchViewStore } from '@/store/match-view-store'
import type { GameEvent } from '@/lib/core/types'

function pokerEvent(input: Partial<GameEvent>): GameEvent {
  return {
    id: input.id ?? 'evt_1',
    matchId: 'match_1',
    gameType: 'poker',
    seq: input.seq ?? 1,
    occurredAt: '2026-05-06T00:00:00Z',
    kind: input.kind ?? 'poker/action',
    actorAgentId: input.actorAgentId ?? null,
    payload: input.payload ?? {},
    visibility: 'public',
    restrictedTo: null,
  }
}

function seedPokerState() {
  const store = useMatchViewStore.getState()
  store.init({
    matchId: 'match_1',
    players: [
      {
        agentId: 'agt_alice',
        displayName: 'Alice',
        avatarEmoji: 'A',
        seatIndex: 0,
        chips: 190,
        currentBet: 4,
        status: 'active',
        holeCards: [{ rank: 'A', suit: 'spades' }, { rank: 'K', suit: 'spades' }],
      },
      {
        agentId: 'agt_bob',
        displayName: 'Bob',
        avatarEmoji: 'B',
        seatIndex: 1,
        chips: 196,
        currentBet: 2,
        status: 'active',
        holeCards: [{ rank: 'Q', suit: 'hearts' }, { rank: 'J', suit: 'hearts' }],
      },
    ],
  })
  store.ingestEvent(
    pokerEvent({
      kind: 'poker/state',
      payload: {
        phase: 'flop',
        handNumber: 2,
        currentActor: 'agt_bob',
        dealerIndex: 0,
        smallBlindIndex: 1,
        bigBlindIndex: 0,
        communityCards: [
          { rank: '2', suit: 'clubs' },
          { rank: '7', suit: 'diamonds' },
          { rank: 'T', suit: 'spades' },
        ],
        pot: 18,
        streetPots: { preflop: 12, flop: 6, turn: 0, river: 0 },
        sidePots: [{ amount: 6, eligiblePlayerIds: ['agt_alice', 'agt_bob'] }],
        stopRequested: true,
        players: [
          {
            id: 'agt_alice',
            seatIndex: 0,
            chips: 190,
            currentBet: 4,
            status: 'active',
            holeCards: [{ rank: 'A', suit: 'spades' }, { rank: 'K', suit: 'spades' }],
          },
          {
            id: 'agt_bob',
            seatIndex: 1,
            chips: 196,
            currentBet: 2,
            status: 'active',
            holeCards: [{ rank: 'Q', suit: 'hearts' }, { rank: 'J', suit: 'hearts' }],
          },
        ],
      },
    }),
  )
}

describe('PokerStatusPanel', () => {
  beforeEach(() => {
    useMatchViewStore.getState().reset()
    seedPokerState()
  })

  it('renders hand, actor, blinds, public cards, pots, and stop request status', () => {
    render(<PokerStatusPanel />)

    expect(screen.getByText('第 2 手')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(screen.getByText('D Alice')).toBeInTheDocument()
    expect(screen.getByText('SB Bob')).toBeInTheDocument()
    expect(screen.getByText('BB Alice')).toBeInTheDocument()
    expect(screen.getByText('总底池 $18')).toBeInTheDocument()
    expect(screen.getByText('翻前 $12')).toBeInTheDocument()
    expect(screen.getByText('翻牌 $6')).toBeInTheDocument()
    expect(screen.getByText('边池 $6')).toBeInTheDocument()
    expect(screen.getByText('本手后结束已请求')).toBeInTheDocument()
    expect(screen.getByText('2♣ 7♦ T♠')).toBeInTheDocument()
  })
})

describe('ActionLog', () => {
  beforeEach(() => {
    useMatchViewStore.getState().reset()
    seedPokerState()
  })

  it('renders poker actions with agent display names', () => {
    useMatchViewStore.getState().ingestEvent(
      pokerEvent({
        id: 'evt_action',
        seq: 9,
        kind: 'poker/action',
        actorAgentId: 'agt_bob',
        payload: { type: 'raise', toAmount: 8 },
      }),
    )

    render(<ActionLog />)

    expect(screen.getByText(/Bob raise to 8/)).toBeInTheDocument()
    expect(screen.queryByText(/agt_bob raise/)).not.toBeInTheDocument()
  })
})

describe('FinishAfterHandButton', () => {
  beforeEach(() => {
    useMatchViewStore.getState().reset()
    useMatchViewStore.getState().init({ matchId: 'match_1', players: [] })
    vi.unstubAllGlobals()
  })

  it('posts a finish-after-hand request and disables after success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, stopRequested: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    render(<FinishAfterHandButton matchId="match_1" status="running" />)
    fireEvent.click(screen.getByRole('button', { name: '本手后结束' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/matches/match_1/end', { method: 'POST' })
    })
    expect(screen.getByRole('button', { name: '已请求本手后结束' })).toBeDisabled()
  })

  it('does not render outside running poker matches', () => {
    render(<FinishAfterHandButton matchId="match_1" status="completed" />)

    expect(screen.queryByRole('button', { name: '本手后结束' })).not.toBeInTheDocument()
  })
})
