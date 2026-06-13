/**
 * Agent module — LLM 基础设施（游戏无关）。
 */
export {
  callLLM,
  testConnection,
  callLLMStreaming,
} from './llm-client'
export type { APIProfile, ChatMessage, LLMResponse } from './llm-client'

export {
  BotAdapter,
  LLMAdapter,
  HumanAdapter,
} from './player-adapter'
export type { DecisionResult, PlayerAdapter } from './player-adapter'
