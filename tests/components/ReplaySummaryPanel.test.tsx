import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ReplaySummaryPanel } from '@/components/match/ReplaySummaryPanel'
import type { GameEvent } from '@/lib/core/types'
import type { PokerUiPlayer } from '@/store/match-view-store'

const players: PokerUiPlayer[] = [
  {
    agentId: 'agt_alice',
    displayName: 'Alice',
    avatarEmoji: 'A',
    seatIndex: 0,
    chips: 100,
    currentBet: 0,
    status: 'active',
    holeCards: [],
  },
  {
    agentId: 'agt_bob',
    displayName: 'Bob',
    avatarEmoji: 'B',
    seatIndex: 1,
    chips: 100,
    currentBet: 0,
    status: 'active',
    holeCards: [],
  },
]

function stateEvent(seq: number, handNumber: number, chips: Record<string, number>, matchComplete = false): GameEvent {
  return {
    id: `evt_${seq}`,
    matchId: 'match_1',
    gameType: 'poker',
    seq,
    occurredAt: '2026-05-06T00:00:00Z',
    kind: 'poker/state',
    actorAgentId: null,
    payload: {
      handNumber,
      matchComplete,
      players: players.map((player) => ({
        id: player.agentId,
        seatIndex: player.seatIndex,
        chips: chips[player.agentId],
        currentBet: 0,
        status: 'active',
        holeCards: [],
      })),
    },
    visibility: 'public',
    restrictedTo: null,
  }
}

describe('ReplaySummaryPanel', () => {
  it('renders final ranking and per-hand chip snapshots from public poker state events', () => {
    render(
      <ReplaySummaryPanel
        gameType="poker"
        players={players}
        initialChips={100}
        events={[
          stateEvent(1, 1, { agt_alice: 100, agt_bob: 100 }),
          stateEvent(2, 2, { agt_alice: 120, agt_bob: 80 }, true),
        ]}
      />,
    )

    expect(screen.getByText('终局排名')).toBeInTheDocument()
    expect(screen.getAllByText('Alice').length).toBeGreaterThan(0)
    expect(screen.getByText('最终筹码 $120')).toBeInTheDocument()
    expect(screen.getByText('+20')).toBeInTheDocument()
    expect(screen.getByText('筹码曲线')).toBeInTheDocument()
    expect(screen.getByText('第 1 手')).toBeInTheDocument()
    expect(screen.getByText('第 2 手')).toBeInTheDocument()
  })
})
