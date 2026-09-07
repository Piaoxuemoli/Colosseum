import type { GameModule } from '@/platform/core/registry'
import type { SurfaceDefinition, SurfaceDefaults } from '@/platform/core/a2ui-types'
import { PokerPlayerContextBuilder } from './agent/context-builder'
import { PokerBotStrategy } from './agent/bot-strategy'
import { PokerResponseParser } from './agent/response-parser'
import { PokerEngine } from './engine/poker-engine'
import type { PokerState } from './engine/poker-types'
import { PokerMemoryModule } from './memory/poker-memory'
// ── A2UI 声明式配置页（设计期手写，构建期打包）──
import matchConfigSurface from './.a2ui/surface/match-config.json'
import pokerDefaults from './.a2ui/data/defaults.json'
import { pokerConfigSchema } from './.a2ui/data/schema'
import { pokerConfigHandle } from './.a2ui/handle/submit'
import { pokerConfigManifest } from './.a2ui/runtime/manifest'

const engine = new PokerEngine()

export const pokerPlugin: GameModule = {
  gameType: 'poker',
  engine: engine as unknown as GameModule['engine'],
  memory: new PokerMemoryModule() as unknown as GameModule['memory'],
  playerContextBuilder: new PokerPlayerContextBuilder(),
  responseParser: new PokerResponseParser(),
  botStrategy: new PokerBotStrategy(),
  publicStateEvent: (state) => engine.makePublicStateEvent(state as PokerState),
  continueAfterBoundary: (state, boundary) =>
    boundary === 'hand-end' ? (engine.continueAfterHand(state as PokerState) as unknown as ReturnType<NonNullable<GameModule['continueAfterBoundary']>>) : null,
  requestStopAfterHand: (state) => engine.requestStopAfterHand(state as PokerState),
  // ── A2UI 声明式配置页 ──
  configSurface: matchConfigSurface as unknown as SurfaceDefinition,
  configSchema: pokerConfigSchema,
  configDefaults: pokerDefaults as SurfaceDefaults,
  configHandle: pokerConfigHandle,
  configManifest: pokerConfigManifest,
}
