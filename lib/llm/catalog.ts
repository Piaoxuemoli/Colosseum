export type ProviderKind = 'openai-compatible' | 'anthropic' | 'custom'

export type ProviderEntry = {
  id: string
  displayName: string
  baseUrl: string
  models: string[]
  kind: ProviderKind
  contextWindowTokens?: number
}

/**
 * Static provider catalog. API keys are never stored here; users provide them
 * at match start and they stay in the client or in-memory runtime keyring.
 */
export const PROVIDER_CATALOG: ProviderEntry[] = [
  {
    id: 'openai',
    displayName: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini'],
    kind: 'openai-compatible',
    contextWindowTokens: 128_000,
  },
  {
    id: 'deepseek',
    displayName: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    kind: 'openai-compatible',
    contextWindowTokens: 128_000,
  },
  {
    id: 'moonshot',
    displayName: 'Moonshot (Kimi)',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
    kind: 'openai-compatible',
    contextWindowTokens: 128_000,
  },
  {
    id: 'qwen',
    displayName: 'Qwen (DashScope)',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen-max', 'qwen-plus', 'qwen-turbo'],
    kind: 'openai-compatible',
    contextWindowTokens: 128_000,
  },
  {
    id: 'anthropic',
    displayName: 'Anthropic Claude',
    baseUrl: 'https://api.anthropic.com',
    models: ['claude-sonnet-4-5', 'claude-opus-4-5'],
    kind: 'anthropic',
    contextWindowTokens: 200_000,
  },
  {
    id: 'custom',
    displayName: 'Custom OpenAI-compatible',
    baseUrl: '',
    models: [],
    kind: 'custom',
  },
]

export function findProvider(id: string): ProviderEntry | undefined {
  return PROVIDER_CATALOG.find((provider) => provider.id === id)
}
