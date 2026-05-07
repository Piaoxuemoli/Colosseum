'use client'

import { create } from 'zustand'
import type { GameEvent } from '@/lib/core/types'
import { useMatchViewStore } from './match-view-store'

/**
 * Replay player state for an already-settled match. Events are fed into the
 * shared `match-view-store` one at a time so the Poker / Werewolf boards
 * render identically to live play.
 *
 * Backward seek is implemented by resetting the view store and replaying
 * events from the beginning up to the target cursor; this keeps the view
 * reducer single-directional (no inverse ops needed).
 */
export type ReplayState = {
  events: GameEvent[]
  /** Count of events already fed into the view store (= next index to consume). */
  cursor: number
  isPlaying: boolean
  /** Playback multiplier (0.5 / 1 / 2 / 4). Must be > 0. */
  speed: number
  /** Base interval between ticks at speed=1x. ReplayControls divides by speed. */
  intervalMs: number
  load(events: GameEvent[]): void
  play(): void
  pause(): void
  stepForward(): void
  stepBackward(): void
  seekTo(index: number): void
  setSpeed(next: number): void
  /** Consume a single event; auto-pauses when the cursor reaches the end. */
  tickOne(): void
  reset(): void
}

const DEFAULTS = {
  events: [] as GameEvent[],
  cursor: 0,
  isPlaying: false,
  speed: 1,
  intervalMs: 500,
}

function replayTo(events: GameEvent[], target: number): void {
  const view = useMatchViewStore.getState()
  view.reset()
  for (let i = 0; i < target; i++) {
    useMatchViewStore.getState().ingestEvent(events[i])
  }
}

export const useReplayStore = create<ReplayState>((set, get) => ({
  ...DEFAULTS,

  load(events) {
    useMatchViewStore.getState().reset()
    set({ ...DEFAULTS, events })
  },

  play() {
    // No-op when there's nothing to play or we're already at the end.
    const { events, cursor } = get()
    if (cursor >= events.length) return
    set({ isPlaying: true })
  },

  pause() {
    set({ isPlaying: false })
  },

  setSpeed(next) {
    if (!Number.isFinite(next) || next <= 0) return
    set({ speed: next })
  },

  stepForward() {
    get().tickOne()
  },

  stepBackward() {
    const { events, cursor } = get()
    const target = Math.max(0, cursor - 1)
    replayTo(events, target)
    set({ cursor: target })
  },

  seekTo(index) {
    const { events } = get()
    const target = Math.max(0, Math.min(events.length, Math.floor(index)))
    replayTo(events, target)
    set({ cursor: target, isPlaying: target < events.length ? get().isPlaying : false })
  },

  tickOne() {
    const { events, cursor } = get()
    if (cursor >= events.length) {
      set({ isPlaying: false })
      return
    }
    useMatchViewStore.getState().ingestEvent(events[cursor])
    const nextCursor = cursor + 1
    set({ cursor: nextCursor, isPlaying: nextCursor < events.length ? get().isPlaying : false })
  },

  reset() {
    useMatchViewStore.getState().reset()
    set({ ...DEFAULTS })
  },
}))
