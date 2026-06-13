import type { GameModule } from '@/platform/core/registry'
import { PokerPlayerContextBuilder } from './agent/context-builder'
import { PokerBotStrategy } from './agent/bot-strategy'
import { PokerResponseParser } from './agent/response-parser'
import { PokerEngine } from './engine/poker-engine'
import type { PokerState } from './engine/poker-types'
import { PokerMemoryModule } from './memory/poker-memory'

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
}
