/**
 * 游戏无关的基础类型。
 */

/** 通用玩家基础信息（游戏无关） */
export interface BasePlayer {
  id: string
  name: string
  type: 'human' | 'bot' | 'llm'
}

/** LLM API 配置 profile */
export interface LLMProfile {
  id: string
  name: string
  provider: string
  model: string
  apiKey: string
  baseUrl: string
}
