// FR-4.6-03 思考链回放过滤（thinking-store）：agentFilter 派生视图
// （history/current 按选手过滤、全量 allHistory/allCurrent 保持）、
// rehydrate（回放光标重灌且保留过滤）、reset 清空。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useThinkingStore, type ThinkingEntry } from '@/frontend/store/thinking-store'

const NOW = 1_723_000_000_000

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW)
  useThinkingStore.getState().reset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

function entry(agentId: string, displayName: string, day: number, phase: string, text: string): ThinkingEntry {
  return { agentId, displayName, handNumber: 0, day, phase, text, at: NOW + day }
}

describe('thinking-store — agentFilter 派生视图', () => {
  it('null filter exposes the full history and current', () => {
    const store = useThinkingStore.getState()
    store.recordThinking(entry('a', 'Alice', 1, 'day.speech', 'A thinks'))
    store.recordThinking(entry('b', 'Bob', 1, 'day.speech', 'B thinks'))
    const state = useThinkingStore.getState()
    expect(state.agentFilter).toBeNull()
    expect(state.history.map((item) => item.agentId)).toEqual(['a', 'b'])
  })

  it('setAgentFilter narrows history/current to that agent only', () => {
    const store = useThinkingStore.getState()
    store.recordThinking(entry('a', 'Alice', 1, 'day.speech', 'A day1'))
    store.recordThinking(entry('b', 'Bob', 1, 'day.speech', 'B day1'))
    store.appendThinking('a', 'Alice', 0, 'A live...')
    store.appendThinking('b', 'Bob', 0, 'B live...')

    useThinkingStore.getState().setAgentFilter('a')
    let state = useThinkingStore.getState()
    expect(state.history.map((item) => item.agentId)).toEqual(['a'])
    expect(Object.keys(state.current)).toEqual(['a'])
    // 全量真相不受过滤影响（chips 汇总、切回全部都用它）。
    expect(state.allHistory.map((item) => item.agentId).sort()).toEqual(['a', 'b'])
    expect(Object.keys(state.allCurrent).sort()).toEqual(['a', 'b'])

    useThinkingStore.getState().setAgentFilter(null)
    state = useThinkingStore.getState()
    expect(state.history.map((item) => item.agentId).sort()).toEqual(['a', 'b'])
    expect(Object.keys(state.current).sort()).toEqual(['a', 'b'])
  })

  it('filtering to an agent with no entries yields empty views, not errors', () => {
    const store = useThinkingStore.getState()
    store.recordThinking(entry('a', 'Alice', 1, 'day.speech', 'A'))
    useThinkingStore.getState().setAgentFilter('ghost')
    const state = useThinkingStore.getState()
    expect(state.history).toEqual([])
    expect(state.current).toEqual({})
    expect(state.allHistory).toHaveLength(1)
  })

  it('finalizeThinking moves the finalized agent into (filtered) history', () => {
    const store = useThinkingStore.getState()
    store.appendThinking('a', 'Alice', 2, 'thinking hard')
    store.appendThinking('b', 'Bob', 2, 'thinking too')
    useThinkingStore.getState().setAgentFilter('b')
    useThinkingStore.getState().finalizeThinking('a')
    useThinkingStore.getState().finalizeThinking('b')

    const state = useThinkingStore.getState()
    // a 的收尾进全量但被过滤视图排除；b 的收尾对过滤视图可见。
    expect(state.allHistory.map((item) => item.agentId).sort()).toEqual(['a', 'b'])
    expect(state.history.map((item) => item.agentId)).toEqual(['b'])
    expect(state.current).toEqual({})
  })

  it('live mutation paths keep the derived views consistent (expire/finalizeAll)', () => {
    const store = useThinkingStore.getState()
    store.appendThinking('a', 'Alice', 1, 'stale thinking')
    useThinkingStore.getState().setAgentFilter('a')
    useThinkingStore.getState().expireStaleThinking(1000, NOW + 5000)
    let state = useThinkingStore.getState()
    expect(state.allHistory.map((item) => item.agentId)).toEqual(['a'])
    expect(state.history.map((item) => item.agentId)).toEqual(['a'])

    store.appendThinking('b', 'Bob', 1, 'b thinking')
    useThinkingStore.getState().finalizeAllThinking()
    state = useThinkingStore.getState()
    expect(state.allHistory.map((item) => item.agentId).sort()).toEqual(['a', 'b'])
    expect(state.history.map((item) => item.agentId)).toEqual(['a'])
  })
})

describe('thinking-store — rehydrate（回放重灌）', () => {
  it('replaces history and clears current while keeping agentFilter', () => {
    const store = useThinkingStore.getState()
    store.recordThinking(entry('a', 'Alice', 1, 'day.speech', 'old'))
    useThinkingStore.getState().setAgentFilter('b')

    useThinkingStore.getState().rehydrate([
      entry('a', 'Alice', 1, 'night.wolves', 'replayed A'),
      entry('b', 'Bob', 1, 'day.speech', 'replayed B'),
    ])
    const state = useThinkingStore.getState()
    expect(state.agentFilter).toBe('b')
    expect(state.allHistory.map((item) => item.agentId)).toEqual(['a', 'b'])
    expect(state.history.map((item) => item.agentId)).toEqual(['b'])
    expect(state.current).toEqual({})
  })

  it('rehydrate with a smaller slice drops future entries (backward seek)', () => {
    const store = useThinkingStore.getState()
    store.rehydrate([
      entry('a', 'Alice', 1, 'day.speech', 'day1'),
      entry('a', 'Alice', 2, 'day.speech', 'day2'),
    ])
    expect(useThinkingStore.getState().allHistory).toHaveLength(2)

    useThinkingStore.getState().rehydrate([entry('a', 'Alice', 1, 'day.speech', 'day1')])
    expect(useThinkingStore.getState().allHistory.map((item) => item.day)).toEqual([1])
  })

  it('reset clears everything including the filter', () => {
    const store = useThinkingStore.getState()
    store.recordThinking(entry('a', 'Alice', 1, 'day.speech', 'x'))
    useThinkingStore.getState().setAgentFilter('a')
    useThinkingStore.getState().reset()
    const state = useThinkingStore.getState()
    expect(state.agentFilter).toBeNull()
    expect(state.allHistory).toEqual([])
    expect(state.history).toEqual([])
  })
})
