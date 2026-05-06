import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('ai', () => ({
  streamText: vi.fn(),
}))

vi.mock('@/lib/llm/provider-factory', () => ({
  createModel: vi.fn(() => ({ modelId: 'mock-model' })),
}))

import { streamText } from 'ai'
import { runDecision } from '@/lib/agent/llm-runtime'

const mockProfile = {
  providerKind: 'openai-compatible' as const,
  providerId: 'mock',
  baseUrl: 'https://example.test/v1',
  apiKey: 'sk-test',
  model: 'mock-model',
}

function mockTextStream(chunks: string[]) {
  vi.mocked(streamText).mockReturnValue({
    textStream: (async function* () {
      for (const chunk of chunks) yield chunk
    })(),
  } as unknown as ReturnType<typeof streamText>)
}

describe('runDecision', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('aggregates thinking and action', async () => {
    const thinking: string[] = []
    mockTextStream(['<thinking>想', '一下</thinking>', '<action>{"type":"call","amount":20}</action>'])

    const result = await runDecision({
      profile: mockProfile,
      agent: { systemPrompt: 'system' },
      userPrompt: 'user',
      onThinkingDelta: (delta) => thinking.push(delta),
    })

    expect(thinking.join('')).toBe('想一下')
    expect(result.thinkingText).toBe('想一下')
    expect(result.action).toEqual({ type: 'call', amount: 20 })
    expect(result.rawResponse).toContain('<action>')
  })

  it('throws parse_fail when no action tag exists', async () => {
    mockTextStream(['<thinking>only thinking</thinking>'])

    await expect(
      runDecision({
        profile: mockProfile,
        agent: { systemPrompt: 'system' },
        userPrompt: 'user',
      }),
    ).rejects.toMatchObject({ kind: 'parse_fail' })
  })

  it('wraps stream failures as api_error', async () => {
    vi.mocked(streamText).mockReturnValue({
      textStream: (async function* () {
        throw new Error('upstream failed')
      })(),
    } as unknown as ReturnType<typeof streamText>)

    await expect(
      runDecision({
        profile: mockProfile,
        agent: { systemPrompt: 'system' },
        userPrompt: 'user',
      }),
    ).rejects.toMatchObject({ kind: 'api_error' })
  })
})
