import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PlayerCard } from '@/games/werewolf/ui/PlayerCard'

describe('PlayerCard', () => {
  it('shows claimed role before the game ends', () => {
    render(
      <PlayerCard
        agentId="a"
        name="Alice"
        alive={true}
        isCurrentActor={false}
        claimedRole="seer"
      />,
    )
    expect(screen.getByText(/自称/)).toHaveTextContent('预言家')
  })

  it('reveals role after the game ends (hides claim)', () => {
    render(
      <PlayerCard
        agentId="a"
        name="A"
        alive={true}
        isCurrentActor={false}
        claimedRole="seer"
        revealedRole="werewolf"
      />,
    )
    expect(screen.getByText('狼人')).toBeInTheDocument()
    expect(screen.queryByText(/自称/)).toBeNull()
  })

  it('renders death overlay with localized cause when dead', () => {
    const { container } = render(
      <PlayerCard
        agentId="a"
        name="A"
        alive={false}
        deathCause="vote"
        isCurrentActor={false}
      />,
    )
    expect(container.textContent).toContain('票出')
  })

  it('does not show a claim chip when none was made', () => {
    render(
      <PlayerCard agentId="a" name="A" alive={true} isCurrentActor={false} />,
    )
    expect(screen.queryByText(/自称/)).toBeNull()
  })
})
