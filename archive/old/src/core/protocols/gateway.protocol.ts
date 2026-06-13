/**
 * Gateway 协议 — 事务管控层的公开接口。
 * Gateway 是 Engine 和 Store 之间的中间层，负责 LLM 调用、解析、验证、执行的完整事务。
 */

import type { ActionResult, GameEvent } from './engine.protocol'
import type { AgentPersonality } from './context.protocol'

/** LLM 聊天消息 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** Agent 决策请求选项 */
export interface AgentActionOptions {
  /** 流式 chunk 回调 */
  onChunk?: (chunk: string) => void
  /** AbortSignal 用于取消 */
  signal?: AbortSignal
  /** 超时毫秒 */
  timeout?: number
  /** Agent 人格（名字、systemPrompt） */
  personality?: AgentPersonality
  /** 该 Agent 对其他玩家的印象 */
  impressions?: Record<string, Record<string, number>>
}

/** Agent 决策结果 */
export interface AgentActionResult<TAction> {
  /** 最终动作 */
  action: TAction
  /** 动作来源 */
  source: 'llm' | 'bot' | 'coerced'
  /** LLM 思考内容 */
  thinking?: string
  /** 原始 LLM 输出 */
  rawOutput?: string
}

/** 印象更新结果 */
export interface ImpressionUpdateResult {
  /** playerId → { dimensionKey → score } */
  impressions: Record<string, Record<string, number>>
  /** 原始 LLM 输出 */
  rawOutput?: string
}

/**
 * GatewayProtocol<TState, TAction>
 *
 * Store 只跟 Gateway 交互，不直接调引擎或 LLM。
 */
export interface GatewayProtocol<TState, TAction> {
  /** 请求 Agent 做决策（完整事务: LLM→解析→验证→fallback） */
  requestAgentAction(
    state: TState,
    playerId: string,
    options?: AgentActionOptions,
  ): Promise<AgentActionResult<TAction>>

  /** 提交动作到引擎（clone + apply） */
  submitAction(state: TState, action: TAction): ActionResult<TState>

  /** 触发印象更新 */
  updateImpressions(
    state: TState,
    playerId: string,
    events: GameEvent[],
  ): Promise<ImpressionUpdateResult>
}
