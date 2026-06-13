/**
 * Gateway — 事务管控中心。
 *
 * 一次 requestAgentAction() = 一个原子事务:
 * LLM → 解析 → 验证 → 执行，或整体 fallback 到 bot。
 * Store 不参与中间步骤，只拿最终结果。
 */

import type {
  EngineProtocol,
  ActionResult,
  GameEvent,
  ContextBuilder,
  ResponseParser,
  BotStrategy,
  AgentPersonality,
  GatewayProtocol,
  AgentActionOptions,
  AgentActionResult,
  ImpressionUpdateResult,
  ChatMessage,
} from '../protocols'

/** LLM 调用函数签名（由外部注入，游戏无关） */
export interface LLMClient {
  chat(
    messages: ChatMessage[],
    options?: {
      onChunk?: (chunk: string) => void
      signal?: AbortSignal
      timeout?: number
    },
  ): Promise<{ content: string; thinking?: string }>
}

/** 根据 playerId 返回 LLMClient 的工厂（支持 per-player API 路由） */
export type LLMClientFactory = (playerId: string) => LLMClient | null

/** Gateway 配置 */
export interface GatewayConfig<TState, TAction> {
  engine: EngineProtocol<TState, TAction, unknown>
  contextBuilder: ContextBuilder<TState, TAction>
  responseParser: ResponseParser<TAction>
  botStrategy: BotStrategy<TState, TAction>
  /** 固定的 LLM client（所有玩家共享同一个 API），或 per-player factory */
  llmClient?: LLMClient
  llmClientFactory?: LLMClientFactory
  /** 最大重试次数 */
  maxRetries?: number
}

/**
 * Gateway<TState, TAction> — 游戏无关的事务管控器。
 */
export class Gateway<TState, TAction>
  implements GatewayProtocol<TState, TAction>
{
  private readonly engine: EngineProtocol<TState, TAction, unknown>
  private readonly contextBuilder: ContextBuilder<TState, TAction>
  private readonly responseParser: ResponseParser<TAction>
  private readonly botStrategy: BotStrategy<TState, TAction>
  private readonly llmClient: LLMClient | null
  private readonly llmClientFactory: LLMClientFactory | null
  private readonly maxRetries: number

  constructor(config: GatewayConfig<TState, TAction>) {
    this.engine = config.engine
    this.contextBuilder = config.contextBuilder
    this.responseParser = config.responseParser
    this.botStrategy = config.botStrategy
    this.llmClient = config.llmClient ?? null
    this.llmClientFactory = config.llmClientFactory ?? null
    this.maxRetries = config.maxRetries ?? 1
  }

  /** 获取指定玩家的 LLMClient（factory 优先，fallback 到固定 client） */
  private getLLMClient(playerId: string): LLMClient | null {
    if (this.llmClientFactory) {
      return this.llmClientFactory(playerId)
    }
    return this.llmClient
  }

  /**
   * 请求 Agent 做决策 — 完整事务。
   *
   * 流程:
   * 1. 获取可用动作
   * 2. 构建 system + user 提示
   * 3. 调用 LLM（per-player API 路由）
   * 4. 解析动作
   * 5. 失败 → 重试（最多 maxRetries 次）
   * 6. 仍然失败 → bot fallback
   */
  async requestAgentAction(
    state: TState,
    playerId: string,
    options?: AgentActionOptions,
  ): Promise<AgentActionResult<TAction>> {
    // [1] 获取可用动作
    const availableActions = this.engine.getAvailableActions(state, playerId)
    if (availableActions.length === 0) {
      // 无可用动作，直接 bot fallback
      return this.botFallback(state, playerId)
    }

    const availableTypes = availableActions.map(a => a.type)

    // 获取该玩家的 LLMClient
    const client = this.getLLMClient(playerId)
    if (!client) {
      // 无 LLM client（无 API profile），走 bot
      return this.botFallback(state, playerId)
    }

    // [2] 构建提示
    const personality: AgentPersonality = options?.personality ?? { name: playerId }
    const impressions = options?.impressions ?? {}
    const systemPrompt = this.contextBuilder.buildSystemPrompt(personality, impressions)
    const userPrompt = this.contextBuilder.buildUserPrompt(state, playerId, availableActions)

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]

    // [3-5] LLM 调用 + 解析 + 重试
    let lastError = ''
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        // [3] 调用 LLM
        const llmResult = await client.chat(
          attempt === 0 ? messages : [
            ...messages,
            { role: 'assistant', content: lastError },
            { role: 'user', content: this.contextBuilder.buildRetryPrompt(lastError, availableTypes) },
          ],
          {
            onChunk: options?.onChunk,
            signal: options?.signal,
            timeout: options?.timeout,
          },
        )

        // [4] 解析动作
        const parseResult = this.responseParser.parseAction(llmResult.content, availableTypes)
        if (!parseResult.ok) {
          lastError = parseResult.error
          continue
        }

        // [5] 验证动作
        const validation = this.engine.validateAction(state, parseResult.action)
        if (!validation.valid) {
          lastError = validation.error || 'Invalid action'
          continue
        }

        return {
          action: parseResult.action,
          source: 'llm',
          thinking: llmResult.thinking,
          rawOutput: llmResult.content,
        }
      } catch (err) {
        lastError = err instanceof Error ? err.message : 'LLM call failed'
        // Network/timeout errors → continue to retry or fallback
        continue
      }
    }

    // [6] 所有尝试失败 → bot fallback
    return this.botFallback(state, playerId)
  }

  /**
   * 提交动作到引擎 — clone + apply。
   */
  submitAction(state: TState, action: TAction): ActionResult<TState> {
    const snapshot = structuredClone(state)
    return this.engine.applyAction(snapshot, action)
  }

  /**
   * 触发印象更新。
   */
  async updateImpressions(
    state: TState,
    playerId: string,
    events: GameEvent[],
  ): Promise<ImpressionUpdateResult> {
    const prompt = this.contextBuilder.buildImpressionPrompt(state, events, {})
    if (!prompt) {
      return { impressions: {} }
    }

    const client = this.getLLMClient(playerId)
    if (!client) {
      return { impressions: {} }
    }

    try {
      const result = await client.chat([
        { role: 'user', content: prompt },
      ])

      const impressions = this.responseParser.parseImpressions(
        result.content,
        [],
      )

      return {
        impressions: impressions || {},
        rawOutput: result.content,
      }
    } catch {
      return { impressions: {} }
    }
  }

  // ---- Private ----

  private botFallback(
    state: TState,
    playerId: string,
  ): AgentActionResult<TAction> {
    const action = this.botStrategy.chooseAction(state, playerId)
    return {
      action,
      source: 'bot',
    }
  }
}
