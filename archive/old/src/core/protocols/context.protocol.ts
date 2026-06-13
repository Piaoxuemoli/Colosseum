/**
 * GamePlugin 子接口 — 上下文拼装、响应解析、Bot 策略、印象配置。
 * 每个游戏实现自己的版本，通过 GamePlugin 注册。
 */

import type { AvailableActionInfo, GameEvent } from './engine.protocol'

/** Agent 人格描述（从 Player 配置来） */
export interface AgentPersonality {
  name: string
  systemPrompt?: string
}

/** 上下文拼装器 — 游戏提供，负责所有提示词相关的文本构建 */
export interface ContextBuilder<TState, _TAction = unknown> {
  /** 系统提示: 角色 + 游戏规则 + 对手印象 + 输出格式 */
  buildSystemPrompt(
    personality: AgentPersonality,
    impressions: Record<string, Record<string, number>>,
  ): string

  /** 用户提示: 当前局面 + 可用动作 */
  buildUserPrompt(
    state: TState,
    playerId: string,
    actions: AvailableActionInfo[],
  ): string

  /** 印象评估请求提示 */
  buildImpressionPrompt(
    state: TState,
    events: GameEvent[],
    currentImpressions: Record<string, Record<string, number>>,
  ): string

  /** 格式错误重试提示 */
  buildRetryPrompt(error: string, availableActions: string[]): string

  /** 本局操作摘要（供印象评估用） */
  buildHandSummary(state: TState): string
}

/** 解析结果 */
export type ParseResult<TAction> =
  | { ok: true; action: TAction }
  | { ok: false; error: string }

/** 响应解析器 */
export interface ResponseParser<TAction> {
  /** 从 LLM 原始输出解析动作 */
  parseAction(raw: string, availableTypes: string[]): ParseResult<TAction>

  /** 从 LLM 原始输出解析印象评分 */
  parseImpressions(
    raw: string,
    dimensionKeys: string[],
  ): Record<string, Record<string, number>> | null
}

/** Bot 策略（离线 fallback） */
export interface BotStrategy<TState, TAction> {
  /** 为指定玩家选择动作 */
  chooseAction(state: TState, playerId: string): TAction
}

/** 印象维度定义 */
export interface ImpressionDimension {
  /** 维度 key，如 'looseness' */
  key: string
  /** 显示标签，如 '入池意愿' */
  label: string
  /** 维度描述 */
  description: string
  /** 取值范围 */
  range: [number, number]
  /** 默认值 */
  default: number
}

/** 印象系统配置 */
export interface ImpressionConfig {
  /** 印象维度列表 */
  dimensions: ImpressionDimension[]
  /** EMA 平滑系数 */
  emaAlpha: number
}
