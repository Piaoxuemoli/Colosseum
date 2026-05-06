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
 * The key is intentionally not cached to avoid leaking credentials across
 * matches or agents.
 */
export function createModel(input: CreateModelInput): LanguageModel {
  const { kind, providerId, baseUrl, model, apiKey } = input

  if (kind === 'openai-compatible' || kind === 'custom') {
    const provider = createOpenAICompatible({
      name: providerId,
      baseURL: baseUrl,
      apiKey,
    })
    return provider(model) as unknown as LanguageModel
  }

  if (kind === 'anthropic') {
    const provider = createAnthropic({
      baseURL: baseUrl,
      apiKey,
    })
    return provider(model) as unknown as LanguageModel
  }

  throw new Error(`unsupported provider kind: ${kind satisfies never}`)
}
