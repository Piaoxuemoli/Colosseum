/**
 * EngineProtocol — 任何游戏引擎必须实现的协议。
 * 引擎层是纯状态机，零 UI/LLM 依赖。
 */

/** 引擎元数据 */
export interface EngineMeta {
  /** 游戏类型标识 */
  gameType: string
  /** 显示名称，如 '德州扑克' */
  displayName: string
  /** 最少玩家数 */
  minPlayers: number
  /** 最多玩家数 */
  maxPlayers: number
  /** 游戏阶段列表 */
  phases: string[]
}

/** 可用动作信息（给 LLM / UI 展示） */
export interface AvailableActionInfo {
  /** 动作类型标识 */
  type: string
  /** 约束条件（如金额范围） */
  constraints?: Record<string, { min?: number; max?: number }>
}

/** 游戏事件（引擎产出，Gateway 消费） */
export interface GameEvent {
  type: string
  payload: Record<string, unknown>
}

/** 引擎动作执行结果 */
export type ActionResult<TState> =
  | { ok: true; state: TState; events: GameEvent[] }
  | { ok: false; error: string }

/**
 * EngineProtocol<TState, TAction, TConfig>
 *
 * TState  — 游戏状态类型（如 GameState）
 * TAction — 动作类型（如 PlayerAction）
 * TConfig — 初始化配置类型（如 GameConfig）
 */
export interface EngineProtocol<TState, TAction, TConfig> {
  /** 用配置创建初始游戏状态 */
  createGame(config: TConfig): TState

  /** 获取指定玩家的可用动作 */
  getAvailableActions(state: TState, playerId: string): AvailableActionInfo[]

  /** 应用动作到状态，返回新状态或错误 */
  applyAction(state: TState, action: TAction): ActionResult<TState>

  /** 校验动作是否合法（不修改状态） */
  validateAction(state: TState, action: TAction): { valid: boolean; error?: string }

  /** 序列化状态为字符串 */
  serialize(state: TState): string

  /** 从字符串反序列化状态 */
  deserialize(data: string): TState

  /** 引擎元数据 */
  readonly meta: EngineMeta
}
