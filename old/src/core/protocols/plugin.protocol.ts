/**
 * GamePlugin — 游戏注册对象。
 * 每个游戏导出一个 GamePlugin 实例，包含引擎、Agent 模块、UI 组件、元数据。
 * 用户选择游戏 → getGame(type) → 返回 plugin → 所有模块自动联动。
 */

import type { ComponentType } from 'react'
import type { EngineProtocol, EngineMeta } from './engine.protocol'
import type {
  ContextBuilder,
  ResponseParser,
  BotStrategy,
  ImpressionConfig,
} from './context.protocol'

/** 游戏元数据（扩展 EngineMeta） */
export interface GameMeta extends EngineMeta {
  /** 分数标签，如 '筹码' | '积分' | '分数' */
  scoreLabel: string
  /** 回合标签，如 '手' | '局' | '回合' */
  roundLabel: string
  /** 牌桌主题 CSS 类名 */
  tableThemeClass?: string
}

/** 牌桌组件 props（游戏提供的 Board 需要接收的 props） */
export interface BoardProps<TState, TAction> {
  gameState: TState
  onAction?: (action: TAction) => void
  currentPlayerId?: string
  /** 当前思考中的 bot ID */
  thinkingBotId?: string
  /** LLM 思考内容 */
  llmThoughts?: Record<string, string>
}

/** 座位组件 props */
export interface SeatProps {
  player: unknown
  isCurrentPlayer: boolean
  isBetTurn: boolean
  badge?: string
}

/** 配置面板 props */
export interface SetupProps<TConfig> {
  config: TConfig
  onChange: (config: TConfig) => void
}

/**
 * GamePlugin<TState, TAction, TConfig>
 *
 * 一个游戏的完整注册对象。
 */
export interface GamePlugin<
  TState = unknown,
  TAction = unknown,
  TConfig = unknown,
> {
  /** 游戏类型标识，如 'poker' | 'doudizhu' */
  readonly gameType: string

  /** 创建引擎实例 */
  createEngine(): EngineProtocol<TState, TAction, TConfig>

  /** 默认配置 */
  defaultConfig: TConfig

  // ---- Agent 集成 ----
  contextBuilder: ContextBuilder<TState, TAction>
  responseParser: ResponseParser<TAction>
  botStrategy: BotStrategy<TState, TAction>
  impressionConfig: ImpressionConfig

  // ---- UI 组件 ----
  BoardComponent: ComponentType<BoardProps<TState, TAction>>
  SeatComponent: ComponentType<SeatProps>
  HistoryDetailComponent: ComponentType<{ data: unknown }>
  SetupComponent: ComponentType<SetupProps<TConfig>>

  // ---- 元数据 ----
  meta: GameMeta
}
