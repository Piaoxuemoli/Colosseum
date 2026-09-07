import type { GameEngine } from '@/platform/engine/contracts'
import type { ApplyActionResult, BoundaryKind } from '@/platform/engine/contracts'
import type { MemoryContextSnapshot, MemoryModule } from '@/platform/memory/contracts'
import type { ZodTypeAny } from 'zod'
import type { GameEvent } from './types'
import type { GameType } from './types'
import type {
  A2UIManifest,
  ConfigHandle,
  SurfaceDefaults,
  SurfaceDefinition,
} from './a2ui-types'

export type GameModule = {
  gameType: GameType
  engine: GameEngine<unknown, unknown, unknown>
  memory: MemoryModule<unknown, unknown, unknown>
  playerContextBuilder: PlayerContextBuilder
  responseParser: ResponseParser
  botStrategy: BotStrategy
  moderatorContextBuilder?: ModeratorContextBuilder
  publicStateEvent?: (state: unknown) => GameEvent
  continueAfterBoundary?: (state: unknown, boundary: BoundaryKind) => ApplyActionResult<unknown> | null
  requestStopAfterHand?: (state: unknown) => unknown
  // ── A2UI 声明式配置页（可选；未提供则该游戏无声明式配置页）──
  // 详见 spec: docs/superpowers/specs/2026-06-16-a2ui-config-page-design-claude.md
  configSurface?: SurfaceDefinition
  configSchema?: ZodTypeAny
  configDefaults?: SurfaceDefaults
  configHandle?: ConfigHandle
  configManifest?: A2UIManifest
}

export interface PlayerContextBuilder {
  build(input: {
    agent: { id: string; systemPrompt: string }
    gameState: unknown
    validActions: unknown[]
    memoryContext: MemoryContextSnapshot
  }): { systemMessage: string; userMessage: string }
}

export interface ModeratorContextBuilder {
  build(input: {
    agent: { id: string; systemPrompt: string }
    gameState: unknown
    recentEvents: unknown[]
  }): { systemMessage: string; userMessage: string }
}

export type ParsedResponse<TAction = unknown> = {
  action: TAction
  thinking: string
  fallbackUsed: boolean
}

export interface ResponseParser {
  parse(rawText: string, validActions: unknown[]): ParsedResponse
}

export interface BotStrategy {
  decide(gameState: unknown, validActions: unknown[]): unknown
}

const registry = new Map<GameType, GameModule>()

export function registerGame(module: GameModule): void {
  registry.set(module.gameType, module)
}

export function getGame(gameType: GameType): GameModule {
  const module = registry.get(gameType)
  if (!module) throw new Error(`gameType not registered: ${gameType}`)
  return module
}

export function hasGame(gameType: GameType): boolean {
  return registry.has(gameType)
}

export function clearRegistry(): void {
  registry.clear()
}
