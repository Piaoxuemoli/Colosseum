'use client'

import { create } from 'zustand'

export type ThinkingEntry = {
  sourceId?: string
  agentId: string
  displayName: string
  handNumber: number
  text: string
  at: number
}

type CurrentThinking = {
  text: string
  displayName: string
  handNumber: number
  updatedAt: number
}

export type ThinkingState = {
  current: Record<string, CurrentThinking>
  history: ThinkingEntry[]
  appendThinking(agentId: string, displayName: string, handNumber: number, delta: string): void
  recordThinking(entry: ThinkingEntry): void
  finalizeThinking(agentId: string): void
  finalizeAllThinking(): void
  expireStaleThinking(maxAgeMs: number, now?: number): void
  reset(): void
}

export const useThinkingStore = create<ThinkingState>((set) => ({
  current: {},
  history: [],

  appendThinking(agentId, displayName, handNumber, delta) {
    set((state) => ({
      current: {
        ...state.current,
        [agentId]: {
          text: (state.current[agentId]?.text ?? '') + delta,
          displayName,
          handNumber,
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
      const history = state.history.filter((item) => {
        if (entry.sourceId && item.sourceId === entry.sourceId) return false
        return !(item.sourceId === undefined && item.agentId === entry.agentId && item.handNumber === entry.handNumber)
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
          { agentId, displayName: item.displayName, handNumber: item.handNumber, text: item.text, at: Date.now() },
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
