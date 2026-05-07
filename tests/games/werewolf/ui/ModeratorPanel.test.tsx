import { render, screen } from '@testing-library/react'
import { act } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { ModeratorPanel } from '@/games/werewolf/ui/ModeratorPanel'
import { SpeechBubbleList } from '@/games/werewolf/ui/SpeechBubble'
import { useMatchViewStore } from '@/store/match-view-store'
import type { GameEvent } from '@/lib/core/types'

function evt(partial: Partial<GameEvent>): GameEvent {
  return {
    id: 'e',
    matchId: 'm',
    gameType: 'werewolf',
    seq: 0,
    occurredAt: '2026-05-06',
    kind: 'werewolf/speak',
    actorAgentId: null,
    payload: {},
    visibility: 'public',
    restrictedTo: null,
    ...partial,
  }
}

describe('ModeratorPanel', () => {
  beforeEach(() => {
    useMatchViewStore.getState().reset()
  })

  it('shows placeholder when no narration recorded', () => {
    render(<ModeratorPanel />)
    expect(screen.getByText(/等待开局/)).toBeInTheDocument()
  })

  it('renders the latest narration text', () => {
    act(() => {
      useMatchViewStore.getState().ingestEvent(
        evt({
          kind: 'werewolf/moderator-narrate',
          payload: { day: 1, upcomingPhase: 'night/werewolfKill', narration: '狼人拍板。' },
        }),
      )
      useMatchViewStore.getState().ingestEvent(
        evt({
          kind: 'werewolf/moderator-narrate',
          payload: { day: 1, upcomingPhase: 'day/announce', narration: '天亮了。' },
        }),
      )
    })
    render(<ModeratorPanel />)
    expect(screen.getByText(/天亮了/)).toBeInTheDocument()
    expect(screen.queryByText(/狼人拍板/)).toBeNull()
  })
})

describe('SpeechBubbleList', () => {
  beforeEach(() => {
    useMatchViewStore.getState().reset()
  })

  it('shows empty state when no speeches', () => {
    render(<SpeechBubbleList />)
    expect(screen.getByText('暂无发言')).toBeInTheDocument()
  })

  it('renders each speech with day + agent + content', () => {
    act(() => {
      useMatchViewStore.getState().ingestEvent(
        evt({ actorAgentId: 'a', payload: { day: 1, content: '我是预言家', claimedRole: 'seer' } }),
      )
      useMatchViewStore.getState().ingestEvent(
        evt({ actorAgentId: 'b', payload: { day: 1, content: '可疑' } }),
      )
    })
    render(<SpeechBubbleList />)
    expect(screen.getByText('我是预言家')).toBeInTheDocument()
    expect(screen.getByText('可疑')).toBeInTheDocument()
    expect(screen.getByText(/自称/)).toHaveTextContent('预言家')
  })
})
