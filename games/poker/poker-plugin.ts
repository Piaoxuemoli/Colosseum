import type { GameModule } from '@/lib/core/registry'
import { PokerPlayerContextBuilder } from './agent/context-builder'
import { PokerBotStrategy } from './agent/bot-strategy'
import { PokerResponseParser } from './agent/response-parser'
import { PokerEngine } from './engine/poker-engine'
import { PokerMemoryModule } from './memory/poker-memory'

export const pokerPlugin: GameModule = {
  gameType: 'poker',
  engine: new PokerEngine() as unknown as GameModule['engine'],
  memory: new PokerMemoryModule() as unknown as GameModule['memory'],
  playerContextBuilder: new PokerPlayerContextBuilder(),
  responseParser: new PokerResponseParser(),
  botStrategy: new PokerBotStrategy(),
}
