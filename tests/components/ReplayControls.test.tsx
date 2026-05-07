import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { ReplayControls } from '@/components/match/ReplayControls'
import type { GameEvent } from '@/lib/core/types'
import { useReplayStore } from '@/store/replay-store'

function evt(seq: number): GameEvent {
  return {
    id: `e-${seq}`,
    matchId: 'm',
    gameType: 'poker',
    seq,
    occurredAt: '2026-05-07',
    kind: 'agent_error',
    actorAgentId: null,
    payload: {},
    visibility: 'public',
    restrictedTo: null,
  }
}

describe('ReplayControls', () => {
  beforeEach(() => {
    useReplayStore.getState().reset()
  })

  it('renders "0 / 0" when no replay is loaded', () => {
    render(<ReplayControls />)
    expect(screen.getByText('0 / 0')).toBeInTheDocument()
  })

  it('play button is disabled when there are no events', () => {
    render(<ReplayControls />)
    const play = screen.getByRole('button', { name: '播放' })
    expect(play).toBeDisabled()
  })

  it('clicking play toggles isPlaying to true then false on pause', () => {
    act(() => {
      useReplayStore.getState().load([evt(1), evt(2)])
    })
    render(<ReplayControls />)
    const play = screen.getByRole('button', { name: '播放' })
    fireEvent.click(play)
    expect(useReplayStore.getState().isPlaying).toBe(true)

    const pause = screen.getByRole('button', { name: '暂停' })
    fireEvent.click(pause)
    expect(useReplayStore.getState().isPlaying).toBe(false)
  })

  it('stepForward button advances cursor', () => {
    act(() => {
      useReplayStore.getState().load([evt(1), evt(2), evt(3)])
    })
    render(<ReplayControls />)
    fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    expect(useReplayStore.getState().cursor).toBe(1)
  })

  it('speed selector updates the store', () => {
    act(() => {
      useReplayStore.getState().load([evt(1)])
    })
    render(<ReplayControls />)
    const select = screen.getByRole('combobox', { name: '播放速度' })
    fireEvent.change(select, { target: { value: '4' } })
    expect(useReplayStore.getState().speed).toBe(4)
  })

  it('rewind button seeks to 0', () => {
    act(() => {
      useReplayStore.getState().load([evt(1), evt(2)])
      useReplayStore.getState().stepForward()
      useReplayStore.getState().stepForward()
    })
    render(<ReplayControls />)
    fireEvent.click(screen.getByRole('button', { name: '回到开头' }))
    expect(useReplayStore.getState().cursor).toBe(0)
  })

  it('fast-forward button jumps cursor to end', () => {
    act(() => {
      useReplayStore.getState().load([evt(1), evt(2), evt(3)])
    })
    render(<ReplayControls />)
    fireEvent.click(screen.getByRole('button', { name: '跳到末尾' }))
    expect(useReplayStore.getState().cursor).toBe(3)
  })

  it('slider drag does NOT seek on every onChange; commit happens on release', () => {
    act(() => {
      useReplayStore.getState().load([evt(1), evt(2), evt(3), evt(4)])
    })
    render(<ReplayControls />)
    const slider = screen.getByRole('slider', { name: '回放进度' })

    // Simulate dragging: intermediate values must NOT mutate store.cursor.
    fireEvent.change(slider, { target: { value: '1' } })
    fireEvent.change(slider, { target: { value: '2' } })
    fireEvent.change(slider, { target: { value: '3' } })
    expect(useReplayStore.getState().cursor).toBe(0)

    // Release commits the final value.
    fireEvent.pointerUp(slider, { currentTarget: { value: '3' } })
    expect(useReplayStore.getState().cursor).toBe(3)
  })
})
