import { describe, expect, it } from 'vitest'

describe('lib/llm/provider-factory', () => {
  it('createModel returns a language model for openai-compatible providers', async () => {
    const { createModel } = await import('@/lib/llm/provider-factory')
    const model = createModel({
      kind: 'openai-compatible',
      providerId: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      apiKey: 'sk-fake-for-type-check',
    })

    expect(typeof (model as unknown as { modelId: string }).modelId).toBe('string')
  })

  it('createModel returns an anthropic model', async () => {
    const { createModel } = await import('@/lib/llm/provider-factory')
    const model = createModel({
      kind: 'anthropic',
      providerId: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      model: 'claude-sonnet-4-5',
      apiKey: 'sk-ant-fake',
    })

    expect(typeof (model as unknown as { modelId: string }).modelId).toBe('string')
  })

  it('throws on unknown kind', async () => {
    const { createModel } = await import('@/lib/llm/provider-factory')
    expect(() =>
      createModel({
        kind: 'bogus' as 'openai-compatible',
        providerId: 'x',
        baseUrl: 'http://x',
        model: 'm',
        apiKey: 'k',
      }),
    ).toThrow(/unsupported/i)
  })
})
