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
  /**
   * 全量实时思考（内部真相）。UI 消费派生视图 `current`（按 agentFilter
   * 过滤后），保证 FR-4.6-03 单选手视角过滤对 live 气泡同样生效。
   */
  allCurrent: Record<string, CurrentThinking>
  /** 全量历史（内部真相）。UI 消费派生视图 `history`。 */
  allHistory: ThinkingEntry[]
  /**
   * 按选手过滤（FR-4.6-03 思考链回放过滤）：null = 全部。live 与回放
   * 共用一份过滤状态；chips 由消费方从 allHistory/allCurrent 汇总。
   */
  agentFilter: string | null
  /** 派生：agentFilter 视角的实时思考（live 气泡与实时区消费）。 */
  current: Record<string, CurrentThinking>
  /** 派生：agentFilter 视角的历史（历史日志消费）。 */
  history: ThinkingEntry[]
  setAgentFilter(agentId: string | null): void
  /**
   * 回放整体重灌（FR-4.6-02/03）：用「截至当前 cursor」的思考条目替换
   * 全量历史（后退 seek 时丢弃未来的条目），保留 agentFilter。
   */
  rehydrate(entries: ThinkingEntry[]): void
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

/** 按当前 agentFilter 派生 UI 视图（current/history）。 */
function deriveViews(state: {
  allCurrent: Record<string, CurrentThinking>
  allHistory: ThinkingEntry[]
  agentFilter: string | null
}): { current: Record<string, CurrentThinking>; history: ThinkingEntry[] } {
  const { allCurrent, allHistory, agentFilter } = state
  if (agentFilter === null) return { current: allCurrent, history: allHistory }
  const filteredCurrent: Record<string, CurrentThinking> = {}
  if (allCurrent[agentFilter]) filteredCurrent[agentFilter] = allCurrent[agentFilter]
  return { current: filteredCurrent, history: allHistory.filter((item) => item.agentId === agentFilter) }
}

export const useThinkingStore = create<ThinkingState>((set) => ({
  allCurrent: {},
  allHistory: [],
  agentFilter: null,
  current: {},
  history: [],

  setAgentFilter(agentId) {
    set((state) => ({ ...deriveViews({ ...state, agentFilter: agentId }), agentFilter: agentId }))
  },

  rehydrate(entries) {
    set((state) => ({
      allCurrent: {},
      allHistory: entries,
      ...deriveViews({ allCurrent: {}, allHistory: entries, agentFilter: state.agentFilter }),
    }))
  },

  appendThinking(agentId, displayName, handNumber, delta, bucket) {
    set((state) => {
      const allCurrent = {
        ...state.allCurrent,
        [agentId]: {
          text: (state.allCurrent[agentId]?.text ?? '') + delta,
          displayName,
          handNumber,
          day: bucket?.day ?? state.allCurrent[agentId]?.day,
          phase: bucket?.phase ?? state.allCurrent[agentId]?.phase,
          updatedAt: Date.now(),
        },
      }
      return { allCurrent, ...deriveViews({ ...state, allCurrent }) }
    })
  },

  recordThinking(entry) {
    set((state) => {
      const text = entry.text.trim()
      const allCurrent = { ...state.allCurrent }
      delete allCurrent[entry.agentId]
      if (text.length === 0) {
        return { allCurrent, ...deriveViews({ ...state, allCurrent }) }
      }

      const nextEntry = { ...entry, text }
      const key = bucketKey(entry.agentId, entry)
      const allHistory = state.allHistory.filter((item) => {
        // Same sourceId always wins (dedupe by persisted event id).
        if (entry.sourceId && item.sourceId === entry.sourceId) return false
        // Same bucket (same hand for poker, same day for werewolf) replaces.
        return bucketKey(item.agentId, item) !== key
      })
      return {
        allCurrent,
        allHistory: [...allHistory, nextEntry],
        ...deriveViews({ allCurrent, allHistory: [...allHistory, nextEntry], agentFilter: state.agentFilter }),
      }
    })
  },

  finalizeThinking(agentId) {
    set((state) => {
      const item = state.allCurrent[agentId]
      if (!item || item.text.trim().length === 0) {
        if (!item) return state
        const allCurrent = { ...state.allCurrent }
        delete allCurrent[agentId]
        return { allCurrent, ...deriveViews({ ...state, allCurrent }) }
      }
      const allCurrent = { ...state.allCurrent }
      delete allCurrent[agentId]
      const entry: ThinkingEntry = {
        agentId,
        displayName: item.displayName,
        handNumber: item.handNumber,
        day: item.day,
        phase: item.phase,
        text: item.text,
        at: Date.now(),
      }
      return {
        allCurrent,
        allHistory: [...state.allHistory, entry],
        ...deriveViews({ allCurrent, allHistory: [...state.allHistory, entry], agentFilter: state.agentFilter }),
      }
    })
  },

  finalizeAllThinking() {
    set((state) => {
      const entries = Object.entries(state.allCurrent).flatMap(([agentId, item]) => {
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
      if (entries.length === 0 && Object.keys(state.allCurrent).length === 0) return state
      const allHistory = [...state.allHistory, ...entries]
      return {
        allCurrent: {},
        allHistory,
        ...deriveViews({ allCurrent: {}, allHistory, agentFilter: state.agentFilter }),
      }
    })
  },

  expireStaleThinking(maxAgeMs, now = Date.now()) {
    set((state) => {
      const allCurrent = { ...state.allCurrent }
      const entries: ThinkingEntry[] = []
      let changed = false

      for (const [agentId, item] of Object.entries(state.allCurrent)) {
        if (now - item.updatedAt < maxAgeMs) continue

        changed = true
        delete allCurrent[agentId]
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
      const allHistory = entries.length > 0 ? [...state.allHistory, ...entries] : state.allHistory
      return { allCurrent, allHistory, ...deriveViews({ allCurrent, allHistory, agentFilter: state.agentFilter }) }
    })
  },

  reset() {
    set({ allCurrent: {}, allHistory: [], agentFilter: null, current: {}, history: [] })
  },
}))
