/**
 * 品类呈现契约（spec: docs/specs/presentation-contract.md）。
 *
 * 把各游戏品类共同满足的呈现要求（PRD FR-4.5-03）收敛为品类无关的四支柱
 * 视图模型：① 态势视图、② 事件流 display hints、③ 阶段模型、④ 结算结构。
 * 每个游戏插件在 `GameModuleV2.presentation` 上暴露纯派生函数；平台与通用
 * 前端只消费本文件的类型与数据形状，不出现任何 gameType 分支。
 *
 * 全部成员为纯数据 / 纯函数声明（方法语法，参数双变），具体泛型插件
 * （PresentationModule<MatchState> 等）可无断言地作为 PresentationModule<unknown>
 * 存入 registry——与 GameModuleV2 的注册策略一致（审计 12 方向）。
 */

// ---------------------------------------------------------------------------
// ② 事件流支柱：engine2 kind → 展示提示（通用动作流渲染输入）
// ---------------------------------------------------------------------------

/** 事件类别（通用动作流的图标 / 分组映射；封闭集）。 */
export type PresentationEventCategory =
  | 'action'
  | 'speech'
  | 'vote'
  | 'phase'
  | 'reveal'
  | 'award'
  | 'death'
  | 'system'
  | 'error'

/** 严重度提示（高亮 / 语气映射；默认 info）。 */
export type PresentationSeverity = 'info' | 'success' | 'warning' | 'critical'

/** 单个 engine2 kind 的展示提示。 */
export interface PresentationEventHint {
  category: PresentationEventCategory
  severity?: PresentationSeverity
  /** 图标提示（emoji 或 icon 名；呈现层自选映射，可为空）。 */
  icon?: string
  /** 该 kind 的人类可读中文名（通用动作流兜底文案）。 */
  label: string
  /**
   * 受众非 public 的语义标记（底牌 / 夜间动作 / 身份等）：通用渲染的
   * 公开视角应对这类条目降权或遮蔽（FR-4.4-01）；audience 本体仍在事件流。
   */
  godOnly?: boolean
}

// ---------------------------------------------------------------------------
// ① 态势视图支柱
// ---------------------------------------------------------------------------

/** 通用选手行状态（封闭三值：品类自映射 folded/all-in → sidelined 等）。 */
export type PresentationPlayerStatus = 'active' | 'sidelined' | 'eliminated'

export interface PresentationSituationRow {
  agentId: string
  seat: number | null
  status: PresentationPlayerStatus
  /** 数值聚合资源（筹码 / 命数 / 票数等），label 自定、value 数值可排序。 */
  resources: Array<{ label: string; value: number }>
  /** 上帝视角注记（角色 / 身份等）；公开视角渲染应省略。 */
  privateNote: string | null
}

export interface PresentationSituationView {
  players: PresentationSituationRow[]
  /** 当前焦点行动者（谁在行动 / 思考），非行动态为 null。 */
  focusAgentId: string | null
  /** 公共聚合（底池 / 存活阵营数等），label + 展示值。 */
  commons: Array<{ label: string; value: string }>
}

// ---------------------------------------------------------------------------
// ③ 阶段模型支柱
// ---------------------------------------------------------------------------

/** 阶段 / 轮次切换边界（回放跳转锚，FR-4.6-02）。 */
export interface PresentationPhaseBoundary {
  seq: number
  /** 轮次计数（德扑 = 手数；狼人 = 天数；对局级事件可为 0）。 */
  cycle: number
  phase: string
}

export interface PresentationPhaseModel {
  /** 本品类会经历的阶段全集（顺序即推进序）。 */
  phases: string[]
  current: string | null
  /** 轮次计数器（手数 / 天数）。 */
  cycle: number
  /** 边界标记，seq 升序；由 fullStream 推导（无流时可为空）。 */
  boundaries: PresentationPhaseBoundary[]
}

// ---------------------------------------------------------------------------
// ④ 结算结构支柱
// ---------------------------------------------------------------------------

export interface PresentationSettlementRow {
  agentId: string
  /** 1 = 冠军；未排名品类可 null（用数组序兜底）。 */
  rank: number | null
  /** 品类关键分数（筹码 / 存活等；无则 null）。 */
  score: number | null
  /** 角色 / 身份（社交推理类终局揭示；无则 null）。 */
  role: string | null
}

export interface PresentationSettlement {
  /** 获胜方人类可读标签（"狼人阵营" / 冠军名等）；平局可为 null。 */
  winnerLabel: string | null
  /** 覆盖全部参赛者，rank 唯一（1 = 冠军）。 */
  rows: PresentationSettlementRow[]
  /** 统计摘要键值对（承接 FR-4.6-01 排名可验证口径）。 */
  digest: Array<{ label: string; value: string }>
}

// ---------------------------------------------------------------------------
// 插件面：PresentationModule
// ---------------------------------------------------------------------------

/**
 * 每个游戏插件必须暴露的呈现契约实现（GameModuleV2.presentation）。
 * 全部纯函数：state / 落库事件流入，视图模型出。
 */
export interface PresentationModule<TState = unknown> {
  /** ① 态势视图。 */
  situation(state: TState): PresentationSituationView
  /** ② 事件流 display hints（须覆盖该游戏 engine2 全部权威 kind）。 */
  eventHints(): Record<string, PresentationEventHint>
  /**
   * ③ 阶段模型。fullStream 形状即 DB 落库 payload（engine2 事件 JSON，
   * 与 visibleEventsFor 的输入一致）；插件内部用既有 guard 收窄。
   */
  phaseModel(state: TState, fullStream?: readonly Record<string, unknown>[]): PresentationPhaseModel
  /** ④ 结算结构；未终局返回 null。 */
  settlement(state: TState): PresentationSettlement | null
}
