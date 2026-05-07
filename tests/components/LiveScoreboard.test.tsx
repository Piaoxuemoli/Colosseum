import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LiveScoreboard } from '@/components/match/LiveScoreboard'
import { useMatchViewStore } from '@/store/match-view-store'

describe('LiveScoreboard', () => {
  it('sorts players by chips desc', () => {
    useMatchViewStore.getState().reset()
    useMatchViewStore.setState({
      players: [
        {
          agentId: 'a',
          displayName: 'Alice',
          avatarEmoji: 'A',
          seatIndex: 0,
          chips: 80,
          currentBet: 0,
          status: 'active',
          holeCards: [],
        },
        {
          agentId: 'b',
          displayName: 'Bob',
          avatarEmoji: 'B',
          seatIndex: 1,
          chips: 140,
          currentBet: 0,
          status: 'active',
          holeCards: [],
        },
      ],
    })

    render(<LiveScoreboard />)
    const items = screen.getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('Bob')
    expect(items[1]).toHaveTextContent('Alice')
  })
})
