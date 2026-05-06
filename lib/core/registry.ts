import type { GameEngine } from '@/lib/engine/contracts'
import type { MemoryContextSnapshot, MemoryModule } from '@/lib/memory/contracts'
import type { GameType } from './types'

export type GameModule = {
  gameType: GameType
  engine: GameEngine<unknown, unknown, unknown>
  memory: MemoryModule<unknown, unknown, unknown>
  playerContextBuilder: PlayerContextBuilder
  responseParser: ResponseParser
  botStrategy: BotStrategy
  moderatorContextBuilder?: ModeratorContextBuilder
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
