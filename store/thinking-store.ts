'use client'

import { create } from 'zustand'

export type ThinkingState = {
  currentActor: string | null
  thinkingByAgent: Record<string, string>
  appendThinking(agentId: string, delta: string): void
  clearThinking(agentId: string): void
  setCurrentActor(agentId: string | null): void
  reset(): void
}

export const useThinkingStore = create<ThinkingState>((set) => ({
  currentActor: null,
  thinkingByAgent: {},

  appendThinking(agentId, delta) {
    set((state) => ({
      thinkingByAgent: {
        ...state.thinkingByAgent,
        [agentId]: (state.thinkingByAgent[agentId] ?? '') + delta,
      },
      currentActor: agentId,
    }))
  },

  clearThinking(agentId) {
    set((state) => {
      if (!state.thinkingByAgent[agentId]) return state
      const next = { ...state.thinkingByAgent }
      delete next[agentId]
      return { thinkingByAgent: next }
    })
  },

  setCurrentActor(agentId) {
    set({ currentActor: agentId })
  },

  reset() {
    set({ currentActor: null, thinkingByAgent: {} })
  },
}))
