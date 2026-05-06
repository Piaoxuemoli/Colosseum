import { describe, expect, it } from 'vitest'
import { PROVIDER_CATALOG, findProvider } from '@/lib/llm/catalog'

describe('lib/llm/catalog', () => {
  it('contains openai, deepseek, and anthropic entries', () => {
    const ids = PROVIDER_CATALOG.map((provider) => provider.id)

    expect(ids).toContain('openai')
    expect(ids).toContain('deepseek')
    expect(ids).toContain('anthropic')
  })

  it('findProvider returns undefined for unknown id', () => {
    expect(findProvider('bogus')).toBeUndefined()
  })

  it('each non-custom entry has a non-empty model list', () => {
    for (const provider of PROVIDER_CATALOG) {
      if (provider.id === 'custom') continue
      expect(provider.models.length).toBeGreaterThan(0)
    }
  })
})
