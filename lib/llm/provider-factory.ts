import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'
import type { ProviderKind } from './catalog'

export type CreateModelInput = {
  kind: ProviderKind
  providerId: string
  baseUrl: string
  model: string
  apiKey: string
}

/**
 * Converts a user supplied provider profile into an AI SDK language model.
 *
 * Version pinning (2026-05-08):
 *   - `ai@5.x`                        → `@ai-sdk/provider@2.x` → LanguageModelV2
 *   - `@ai-sdk/openai-compatible@1.x` → `@ai-sdk/provider@2.x` ✅ matches
 *   - `@ai-sdk/anthropic@2.x`         → `@ai-sdk/provider@2.x` ✅ matches
 *
 * `@ai-sdk/openai-compatible@2.x` and `@ai-sdk/anthropic@3.x` moved to
 * `provider@3` (LanguageModelV3) which ai@5 rejects at runtime with
 * "Unsupported model version v3". Don't bump those without also bumping `ai`.
 *
 * The API key is intentionally not cached: we construct a fresh provider per
 * call so credentials never leak across matches or agents.
 */
export function createModel(input: CreateModelInput): LanguageModel {
  const { kind, providerId, baseUrl, model, apiKey } = input

  if (kind === 'openai-compatible' || kind === 'custom') {
    const provider = createOpenAICompatible({
      name: providerId,
      baseURL: baseUrl,
      apiKey,
    })
    return provider(model)
  }

  if (kind === 'anthropic') {
    const provider = createAnthropic({
      baseURL: baseUrl,
      apiKey,
    })
    return provider(model)
  }

  throw new Error(`unsupported provider kind: ${kind satisfies never}`)
}
