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

  it('replaces temporary history with persisted thinking for the same hand and agent', () => {
    useThinkingStore.getState().appendThinking('agent-1', 'Agent One', 3, 'partial')
    useThinkingStore.getState().finalizeThinking('agent-1')

    useThinkingStore.getState().recordThinking({
      agentId: 'agent-1',
      displayName: 'Agent One',
      handNumber: 3,
      text: 'complete persisted thinking',
      at: 10_000,
    })

    expect(useThinkingStore.getState().current['agent-1']).toBeUndefined()
    expect(useThinkingStore.getState().history).toHaveLength(1)
    expect(useThinkingStore.getState().history[0]).toMatchObject({
      agentId: 'agent-1',
      handNumber: 3,
      text: 'complete persisted thinking',
    })
  })

  it('keeps multiple persisted thinking records from the same hand', () => {
    useThinkingStore.getState().recordThinking({
      sourceId: 'evt-1',
      agentId: 'agent-1',
      displayName: 'Agent One',
      handNumber: 3,
      text: 'first decision',
      at: 10_000,
    })
    useThinkingStore.getState().recordThinking({
      sourceId: 'evt-2',
      agentId: 'agent-1',
      displayName: 'Agent One',
      handNumber: 3,
      text: 'second decision',
      at: 11_000,
    })

    expect(useThinkingStore.getState().history.map((entry) => entry.text)).toEqual([
      'first decision',
      'second decision',
    ])
  })
})
