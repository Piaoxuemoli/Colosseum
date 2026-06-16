'use client'

import { create } from 'zustand'

export type ThinkingEntry = {
  sourceId?: string
  agentId: string
  displayName: string
  handNumber: number
  /**
   * Werewolf grouping key. Poker entries leave this undefined and group by
   * `handNumber`; werewolf entries carry the `state.day` the agent reasoned
   * in (paired with `phase` so the UI can show「第 N 夜 / 第 N 天」).
   */
  day?: number
  phase?: string
  text: string
  at: number
}

type CurrentThinking = {
  text: string
  displayName: string
  handNumber: number
  day?: number
  phase?: string
  updatedAt: number
}

export type ThinkingState = {
  current: Record<string, CurrentThinking>
  history: ThinkingEntry[]
  appendThinking(
    agentId: string,
    displayName: string,
    handNumber: number,
    delta: string,
    bucket?: { day?: number; phase?: string },
  ): void
  recordThinking(entry: ThinkingEntry): void
  finalizeThinking(agentId: string): void
  finalizeAllThinking(): void
  expireStaleThinking(maxAgeMs: number, now?: number): void
  reset(): void
}

/**
 * Dedup bucket key. Werewolf entries group by (agentId, day) so reasoning
 * from different days never clobber each other; poker entries (day=undefined)
 * keep the legacy (agentId, handNumber) grouping.
 */
function bucketKey(agentId: string, entry: { day?: number; handNumber: number }): string {
  return entry.day !== undefined ? `${agentId}:d${entry.day}` : `${agentId}:h${entry.handNumber}`
}

export const useThinkingStore = create<ThinkingState>((set) => ({
  current: {},
  history: [],

  appendThinking(agentId, displayName, handNumber, delta, bucket) {
    set((state) => ({
      current: {
        ...state.current,
        [agentId]: {
          text: (state.current[agentId]?.text ?? '') + delta,
          displayName,
          handNumber,
          day: bucket?.day ?? state.current[agentId]?.day,
          phase: bucket?.phase ?? state.current[agentId]?.phase,
          updatedAt: Date.now(),
        },
      },
    }))
  },

  recordThinking(entry) {
    set((state) => {
      const text = entry.text.trim()
      const nextCurrent = { ...state.current }
      delete nextCurrent[entry.agentId]
      if (text.length === 0) {
        return { current: nextCurrent }
      }

      const nextEntry = { ...entry, text }
      const key = bucketKey(entry.agentId, entry)
      const history = state.history.filter((item) => {
        // Same sourceId always wins (dedupe by persisted event id).
        if (entry.sourceId && item.sourceId === entry.sourceId) return false
        // Same bucket (same hand for poker, same day for werewolf) replaces.
        return bucketKey(item.agentId, item) !== key
      })
      return {
        current: nextCurrent,
        history: [...history, nextEntry],
      }
    })
  },

  finalizeThinking(agentId) {
    set((state) => {
      const item = state.current[agentId]
      if (!item || item.text.trim().length === 0) {
        if (!item) return state
        const nextCurrent = { ...state.current }
        delete nextCurrent[agentId]
        return { current: nextCurrent }
      }
      const nextCurrent = { ...state.current }
      delete nextCurrent[agentId]
      return {
        current: nextCurrent,
        history: [
          ...state.history,
          {
            agentId,
            displayName: item.displayName,
            handNumber: item.handNumber,
            day: item.day,
            phase: item.phase,
            text: item.text,
            at: Date.now(),
          },
        ],
      }
    })
  },

  finalizeAllThinking() {
    set((state) => {
      const entries = Object.entries(state.current).flatMap(([agentId, item]) => {
        if (item.text.trim().length === 0) return []
        return [
          {
            agentId,
            displayName: item.displayName,
            handNumber: item.handNumber,
            day: item.day,
            phase: item.phase,
            text: item.text,
            at: Date.now(),
          },
        ]
      })
      if (entries.length === 0 && Object.keys(state.current).length === 0) return state
      return { current: {}, history: [...state.history, ...entries] }
    })
  },

  expireStaleThinking(maxAgeMs, now = Date.now()) {
    set((state) => {
      const nextCurrent = { ...state.current }
      const entries: ThinkingEntry[] = []
      let changed = false

      for (const [agentId, item] of Object.entries(state.current)) {
        if (now - item.updatedAt < maxAgeMs) continue

        changed = true
        delete nextCurrent[agentId]
        if (item.text.trim().length > 0) {
          entries.push({
            agentId,
            displayName: item.displayName,
            handNumber: item.handNumber,
            day: item.day,
            phase: item.phase,
            text: item.text,
            at: now,
          })
        }
      }

      if (!changed) return state
      return { current: nextCurrent, history: entries.length > 0 ? [...state.history, ...entries] : state.history }
    })
  },

  reset() {
    set({ current: {}, history: [] })
  },
}))
