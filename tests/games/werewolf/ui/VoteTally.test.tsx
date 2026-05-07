import { render, screen } from '@testing-library/react'
import { act } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { VoteTally } from '@/games/werewolf/ui/VoteTally'
import { useMatchViewStore } from '@/store/match-view-store'
import type { GameEvent } from '@/lib/core/types'

function evt(partial: Partial<GameEvent>): GameEvent {
  return {
    id: Math.random().toString(36),
    matchId: 'm',
    gameType: 'werewolf',
    seq: 0,
    occurredAt: '2026-05-06',
    kind: 'werewolf/vote',
    actorAgentId: null,
    payload: {},
    visibility: 'public',
    restrictedTo: null,
    ...partial,
  }
}

describe('VoteTally', () => {
  beforeEach(() => {
    useMatchViewStore.getState().reset()
  })

  it('returns nothing when no votes on current day', () => {
    const { container } = render(<VoteTally />)
    expect(container.firstChild).toBeNull()
  })

  it('shows top targets sorted by count', () => {
    act(() => {
      const store = useMatchViewStore.getState()
      // day follows the moderator-narrate; seed it to day 1.
      store.ingestEvent(
        evt({
          kind: 'werewolf/moderator-narrate',
          payload: { day: 1, upcomingPhase: 'day/vote', narration: '投票' },
        }),
      )
      store.ingestEvent(evt({ actorAgentId: 'a', payload: { day: 1, target: 'x' } }))
      store.ingestEvent(evt({ actorAgentId: 'b', payload: { day: 1, target: 'x' } }))
      store.ingestEvent(evt({ actorAgentId: 'c', payload: { day: 1, target: 'y' } }))
    })

    render(<VoteTally />)
    const items = screen.getAllByText(/^[xy]$/)
    // leading target is x (2 votes) before y (1)
    expect(items[0].textContent).toBe('x')
    expect(items[1].textContent).toBe('y')
  })

  it('renders "全员弃票" when every vote on the current day is null', () => {
    act(() => {
      const store = useMatchViewStore.getState()
      store.ingestEvent(
        evt({
          kind: 'werewolf/moderator-narrate',
          payload: { day: 1, upcomingPhase: 'day/vote', narration: '投票' },
        }),
      )
      store.ingestEvent(evt({ actorAgentId: 'a', payload: { day: 1, target: null } }))
    })
    render(<VoteTally />)
    expect(screen.getByText('全员弃票')).toBeInTheDocument()
  })
})
