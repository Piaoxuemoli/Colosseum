'use client'

import { create } from 'zustand'

export type ThinkingEntry = {
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
}

export type ThinkingState = {
  current: Record<string, CurrentThinking>
  history: ThinkingEntry[]
  appendThinking(agentId: string, displayName: string, handNumber: number, delta: string): void
  finalizeThinking(agentId: string): void
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
        },
      },
    }))
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

  reset() {
    set({ current: {}, history: [] })
  },
}))
