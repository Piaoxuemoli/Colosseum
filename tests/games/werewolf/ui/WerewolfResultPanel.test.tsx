import { render, screen } from '@testing-library/react'
import { act } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WerewolfResultPanel } from '@/games/werewolf/ui/WerewolfResultPanel'
import { useMatchViewStore } from '@/store/match-view-store'
import type { PokerUiPlayer } from '@/store/match-view-store'
import type { GameEvent } from '@/lib/core/types'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

function evt(partial: Partial<GameEvent>): GameEvent {
  return {
    id: 'e',
    matchId: 'm',
    gameType: 'werewolf',
    seq: 0,
    occurredAt: '2026-05-06',
    kind: 'werewolf/game-end',
    actorAgentId: null,
    payload: {},
    visibility: 'public',
    restrictedTo: null,
    ...partial,
  }
}

const players: PokerUiPlayer[] = [
  {
    agentId: 'a',
    displayName: 'Alice',
    avatarEmoji: 'A',
    seatIndex: 0,
    chips: 0,
    currentBet: 0,
    status: 'active',
    holeCards: [],
  },
  {
    agentId: 'b',
    displayName: 'Bob',
    avatarEmoji: 'B',
    seatIndex: 1,
    chips: 0,
    currentBet: 0,
    status: 'active',
    holeCards: [],
  },
]

describe('WerewolfResultPanel', () => {
  beforeEach(() => {
    useMatchViewStore.getState().reset()
  })

  it('remains closed while the game is live', () => {
    render(<WerewolfResultPanel players={players} />)
    expect(screen.queryByText(/胜利/)).toBeNull()
  })

  it('opens on werewolf victory with role reveals', () => {
    act(() => {
      useMatchViewStore.getState().ingestEvent(
        evt({
          payload: {
            winner: 'werewolves',
            actualRoles: { a: 'werewolf', b: 'seer' },
          },
        }),
      )
    })
    render(<WerewolfResultPanel players={players} />)
    expect(screen.getByText(/狼人阵营胜利/)).toBeInTheDocument()
    expect(screen.getByText('狼人')).toBeInTheDocument()
    expect(screen.getByText('预言家')).toBeInTheDocument()
  })

  it('shows tie title when the game timed out', () => {
    act(() => {
      useMatchViewStore.getState().ingestEvent(
        evt({ payload: { winner: 'tie', actualRoles: {} } }),
      )
    })
    render(<WerewolfResultPanel players={players} />)
    expect(screen.getByText(/平局/)).toBeInTheDocument()
  })
})
