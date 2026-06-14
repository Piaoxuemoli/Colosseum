import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useThinkingStore } from '../thinking-store'

describe('thinking store', () => {
  beforeEach(() => {
    useThinkingStore.getState().reset()
    vi.useRealTimers()
  })

  it('expires stale current thinking into history', () => {
    vi.setSystemTime(1_000)
    useThinkingStore.getState().appendThinking('agent-1', 'Agent One', 3, 'I need to fold.')

    useThinkingStore.getState().expireStaleThinking(4_500, 6_000)

    expect(useThinkingStore.getState().current['agent-1']).toBeUndefined()
    expect(useThinkingStore.getState().history).toEqual([
      {
        agentId: 'agent-1',
        displayName: 'Agent One',
        handNumber: 3,
        text: 'I need to fold.',
        at: 6_000,
      },
    ])
  })
})
