/**
 * Core protocols — 统一导出。
 * 所有协议接口从这里导入。
 */

// Engine Layer
export type {
  EngineProtocol,
  EngineMeta,
  AvailableActionInfo,
  ActionResult,
  GameEvent,
} from './engine.protocol'

// Context / Agent interfaces
export type {
  AgentPersonality,
  ContextBuilder,
  ParseResult,
  ResponseParser,
  BotStrategy,
  ImpressionDimension,
  ImpressionConfig,
} from './context.protocol'

// Plugin
export type {
  GamePlugin,
  GameMeta,
  BoardProps,
  SeatProps,
  SetupProps,
} from './plugin.protocol'

// Gateway
export type {
  ChatMessage,
  AgentActionOptions,
  AgentActionResult,
  ImpressionUpdateResult,
  GatewayProtocol,
} from './gateway.protocol'
