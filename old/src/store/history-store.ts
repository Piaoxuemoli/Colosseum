import { create } from 'zustand'
import type { HandHistory } from '../types/history'
import type { SessionSummary } from '../types/ui'
import { getAllHistories, deleteHistory as dbDeleteHistory, clearAllHistories as dbClearAll } from '../db/history-service'

interface HistoryStore {
  histories: HandHistory[]
  selectedHistory: HandHistory | null

  // Session grouping
  sessions: SessionSummary[]
  selectedSessionId: string | null
  filteredHistories: HandHistory[]

  loadHistories: () => Promise<void>
  setHistories: (histories: HandHistory[]) => void
  addHistory: (history: HandHistory) => void
  deleteHistory: (id: string) => Promise<void>
  selectHistory: (history: HandHistory | null) => void
  selectSession: (sessionId: string | null) => void
  clearHistories: () => Promise<void>
}

function buildSessionSummaries(histories: HandHistory[]): SessionSummary[] {
  const sessionMap = new Map<string, HandHistory[]>()
  for (const h of histories) {
    const sid = h.sessionId || 'unknown'
    if (!sessionMap.has(sid)) sessionMap.set(sid, [])
    sessionMap.get(sid)!.push(h)
  }

  const sessions: SessionSummary[] = []
  for (const [sessionId, hands] of sessionMap) {
    const sorted = hands.sort((a, b) => a.timestamp - b.timestamp)
    const allPlayerNames = new Set<string>()
    for (const h of sorted) {
      for (const p of h.players) allPlayerNames.add(p.name)
    }
    const latest = sorted[sorted.length - 1]
    const latestWinner = latest.winners[0]
      ? (latest.players.find(p => p.id === latest.winners[0].playerId)?.name || latest.winners[0].playerId)
      : 'Unknown'

    sessions.push({
      sessionId,
      startTime: sorted[0].timestamp,
      handCount: sorted.length,
      playerNames: [...allPlayerNames],
      latestWinner,
    })
  }

  return sessions.sort((a, b) => b.startTime - a.startTime)
}

export const useHistoryStore = create<HistoryStore>((set, get) => ({
  histories: [],
  selectedHistory: null,

  sessions: [],
  selectedSessionId: null,
  filteredHistories: [],

  setHistories: (histories: HandHistory[]) => {
    const sorted = histories.sort((a, b) => b.timestamp - a.timestamp)
    set({ histories: sorted, sessions: buildSessionSummaries(sorted) })
  },

  loadHistories: async () => {
    try {
      const histories = await getAllHistories()
      const sessions = buildSessionSummaries(histories)
      set({ histories, sessions })
    } catch (err) {
      console.error('Failed to load histories from IndexedDB:', err)
    }
  },

  addHistory: (history: HandHistory) => {
    set(state => {
      const histories = [history, ...state.histories]
      return {
        histories,
        sessions: buildSessionSummaries(histories),
        filteredHistories: state.selectedSessionId
          ? histories.filter(h => h.sessionId === state.selectedSessionId)
          : state.filteredHistories,
      }
    })
  },

  deleteHistory: async (id: string) => {
    try {
      await dbDeleteHistory(id)
      set(state => ({
        histories: state.histories.filter(h => h.id !== id),
        selectedHistory: state.selectedHistory?.id === id ? null : state.selectedHistory,
      }))
    } catch (err) {
      console.error('Failed to delete history:', err)
    }
  },

  selectHistory: (history: HandHistory | null) => {
    set({ selectedHistory: history })
  },

  selectSession: (sessionId: string | null) => {
    const { histories } = get()
    if (!sessionId) {
      set({
        selectedSessionId: null,
        filteredHistories: [],
        selectedHistory: null,
      })
      return
    }
    const filtered = histories
      .filter(h => h.sessionId === sessionId)
      .sort((a, b) => b.timestamp - a.timestamp)
    set({
      selectedSessionId: sessionId,
      filteredHistories: filtered,
      selectedHistory: null,
    })
  },

  clearHistories: async () => {
    try {
      await dbClearAll()
    } catch (err) {
      console.error('Failed to clear histories:', err)
    }
    set({
      histories: [],
      selectedHistory: null,
      sessions: [],
      selectedSessionId: null,
      filteredHistories: [],
    })
  },
}))
