/**
 * Core module — 统一导出。
 */

// Protocols
export * from './protocols/index'

// Registry
export {
  registerGame,
  getGame,
  getRegisteredGameTypes,
  getAllPlugins,
  clearRegistry,
} from './registry/game-registry'

// Base types
export type { BasePlayer, LLMProfile } from './types/base'
