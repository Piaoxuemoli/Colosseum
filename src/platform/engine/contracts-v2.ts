/**
 * Engine2 平台插件契约（spec: docs/specs/engine2-integration.md §2/§3/§4）。
 *
 * GameModuleV2 是每个游戏对 GM 暴露的唯一运行时面：全部同步纯函数，IO 归 GM；
 * GM（backend/orchestrator/game-master.ts）不得包含任何 gameType 分支，
 * 跨游戏差异全部收敛在各游戏的 integration/plugin-v2.ts 实现里。
 *
 * 成员声明一律使用方法语法（method syntax）：TS 对方法参数采用双变检查，
 * 因此 `GameModuleV2<PokerState, PlayerAction>` 可以无断言地注册为
 * `GameModuleV2<unknown, unknown>`（消除旧插件面的 `as unknown as` 双重断言）。
 */

import type { GameType, MatchResult } from '@/platform/core/types'

// ---------------------------------------------------------------------------
// 事件信封（spec §3）
// ---------------------------------------------------------------------------

/**
 * 中立受众标记：poker `EventAudience` 与 werewolf `Audience` 的公共投影。
 * `self` 同时承载德扑 `self:<seatId>` 与狼人 `role-self:<agentId>` 两种
 * restrictedTo 词法（scope 字段区分），完整语义以 payload 内的引擎原生
 * `audience` 字段为准。
 */
export type V2Audience =
  | { kind: 'public' }
  | { kind: 'delayed-public' }
  | { kind: 'wolves' }
  | { kind: 'moderator' }
  | { kind: 'sheriff' }
  | { kind: 'self'; scope: 'self' | 'role-self'; agentId: string }

/** 引擎事件的平台中立信封：`raw` 即完整 engine2 事件对象（含 audience 本体）。 */
export interface V2Event {
  /** engine2 事件 kind（未加 `${gameType}:v2:` 前缀）。 */
  kind: string
  /** 引擎事件序（对局内单调，spec §3）。 */
  seq: number
  actorAgentId: string | null
  isDefault: boolean
  audience: V2Audience
  raw: Record<string, unknown>
}

/** 受众 → DB visibility（public → public；否则 role-restricted）。 */
export function v2Visibility(audience: V2Audience): 'public' | 'role-restricted' {
  return audience.kind === 'public' ? 'public' : 'role-restricted'
}

/** 受众 → restrictedTo 数组（词法见 spec §3：wolves / role-self:x / moderator / self:x / delayed-public）。 */
export function v2RestrictedTo(audience: V2Audience): string[] | null {
  switch (audience.kind) {
    case 'public':
      return null
    case 'self':
      return [`${audience.scope}:${audience.agentId}`]
    case 'delayed-public':
    case 'wolves':
    case 'moderator':
    case 'sheriff':
      return [audience.kind]
  }
}

// ---------------------------------------------------------------------------
// 动作与拒绝
// ---------------------------------------------------------------------------

/**
 * 合法动作说明（spec §4 legalActions 载荷）。在旧 `ActionSpec` 字段之上
 * 补充狼人杀需要的 targetIds / allowNone（WFR-303 机器可读动作契约）。
 */
export interface V2ActionSpec {
  type: string
  label?: string
  minAmount?: number
  maxAmount?: number
  /** 非空合法目标（仅目标型动作）。 */
  targetIds?: string[]
  /** null/pass 变体是否合法（空刀 / 弃票 / pass）。 */
  allowNone?: boolean
}

/** 结构化拒绝（对齐 engine2 的 ActionRejection / ConfigRejection 形态）。 */
export interface V2Rejection {
  code: string
  message: string
  detail?: Record<string, unknown>
}

export type V2CreateMatchResult<TState> =
  | { ok: true; state: TState; events: V2Event[] }
  | { ok: false; rejection: V2Rejection }

export type V2ApplyResult<TState> =
  | { ok: true; state: TState; events: V2Event[] }
  | { ok: false; rejection: V2Rejection }

export type V2Classification =
  | { kind: 'awaiting-action'; actorAgentId: string }
  | { kind: 'finished'; result: MatchResult }

export type V2NormalizeResult<TAction> =
  | { ok: true; action: TAction }
  | { ok: false; rejection: V2Rejection }

// ---------------------------------------------------------------------------
// 印象钩子（spec §5：扑克 hand-ended → 印象合成信号；IO 归 GM）
// ---------------------------------------------------------------------------

export interface V2ImpressionsSignal {
  handNumber: number
  /** 由 v2 事件流推导的工作记忆动作日志（替代旧 actionHistory 读取）。 */
  workingLog: Array<{ seq: number; kind: string; actorAgentId: string | null; payload: Record<string, unknown> }>
  /** 面向既有 memory.synthesizeEpisodic 的按目标 finalState 适配器（纯函数）。 */
  finalStateFor: (targetAgentId: string) => unknown
}

export interface V2ImpressionsMemoryPort {
  synthesizeEpisodic(input: {
    working: unknown
    finalState: unknown
    observerAgentId: string
    targetAgentId: string | null
    matchId: string
  }): unknown
  updateSemantic(current: unknown, episodic: unknown): unknown
  serializeEpisodic(episodic: unknown): Record<string, unknown>
  serializeSemantic(semantic: unknown): Record<string, unknown>
  deserializeSemantic(raw: Record<string, unknown>): unknown
  renderNote(input: {
    observerName: string
    targetName: string
    semantic: unknown
    recentEpisodes: Array<Record<string, unknown>>
  }): string
  handCountOf(profileJson: Record<string, unknown>): number | null
}

export interface V2Impressions {
  fromBatch(
    state: unknown,
    batch: readonly V2Event[],
    fullStream: readonly Record<string, unknown>[],
  ): V2ImpressionsSignal[]
  memory: V2ImpressionsMemoryPort
}

// ---------------------------------------------------------------------------
// 插件面（spec §2 + 集成所需的少量纯辅助成员）
// ---------------------------------------------------------------------------

export interface GameModuleV2<TState, TAction> {
  gameType: GameType

  /** 开局：引擎配置解析 + 建局；拒绝零副作用（结构化 rejection）。 */
  createMatch(config: unknown, agentIds: string[], seed?: string): V2CreateMatchResult<TState>
  classify(state: TState): V2Classification
  /** 引擎 legalActionSet / availableActions 的包装。 */
  legalActions(state: TState, actorAgentId: string): V2ActionSpec[]
  /** PFR-501 / WFR 机械量。 */
  decisionContext(state: TState, actorAgentId: string): Record<string, unknown>
  /** 引擎 normalize + LLM 别名容错（GM 校验链第一环，spec §4）。 */
  normalizeAction(raw: unknown, state: TState, actorAgentId: string): V2NormalizeResult<TAction>
  applyAction(state: TState, actorAgentId: string, action: TAction): V2ApplyResult<TState>
  /** 兜底/超时驱动（WFR-304 / GM fallback 链）。 */
  applyDefaultAction(state: TState): V2ApplyResult<TState>
  /**
   * 本手结束后终止（仅德扑有意义；狼人杀返回原 state）。
   * 返回引擎产生的事件（德扑 stop-requested）——丢弃会造成引擎 seq 空洞，
   * 故与 spec §2 的 `TState` 返回值相比多带 events（spec §3 全量落库的必然推论）。
   */
  requestStopAfterCurrentHand(state: TState): { state: TState; events: V2Event[] }
  /** 强制终局 + 排名。 */
  terminateImmediately(state: TState): V2ApplyResult<TState>
  /** 游戏专属钩子（扑克 hand-ended → 印象合成信号；纯函数、无 IO）。 */
  onEventsBatch(state: TState, events: readonly V2Event[]): void

  // ── 集成辅助（纯函数，供 GM 无分支驱动）──

  /** agent 决策上下文的唯一真相：visibleEvents(fullStream, agentId)（spec §1.3/§4）。 */
  visibleEventsFor(fullStream: readonly Record<string, unknown>[], agentId: string): Record<string, unknown>[]
  /** 为 GM 合成的 agent/thinking 行预留引擎 seq（保持事件序单调无碰撞）。 */
  reserveEventSeq(state: TState): { state: TState; seq: number }
  /** thinking 事件的 handNumber/day/phase（classify 前状态读取，spec §3）。 */
  stateSummary(state: TState): { handNumber: number; day: number; phase: string }
  /** v2 消息的 gameInfo 摘要（spec §4）。 */
  gameInfo(state: TState): Record<string, unknown>
  /** 印象钩子（仅扑克提供）。 */
  impressions?: V2Impressions
}

// ---------------------------------------------------------------------------
// GM → agent 的 v2 消息契约（spec §4）
// ---------------------------------------------------------------------------

export interface V2AgentDecisionData {
  engineVersion: 2
  /** visibleEvents(allEvents, actorAgentId) 最近 N 条（引擎原生事件对象）。 */
  events: Record<string, unknown>[]
  legalActions: V2ActionSpec[]
  decisionContext: Record<string, unknown>
  gameInfo: Record<string, unknown>
}
