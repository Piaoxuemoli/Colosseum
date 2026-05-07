import type { GameModule } from '@/lib/core/registry'
import { WerewolfBotStrategy } from './agent/bot-strategy'
import { WerewolfPlayerContextBuilder } from './agent/context-builder'
import { WerewolfModeratorContextBuilder } from './agent/moderator-context'
import { WerewolfResponseParser } from './agent/response-parser'
import { werewolfEngine } from './engine/werewolf-engine'
import { WerewolfMemoryModule } from './memory/werewolf-memory'

export const werewolfPlugin: GameModule = {
  gameType: 'werewolf',
  engine: werewolfEngine as unknown as GameModule['engine'],
  memory: new WerewolfMemoryModule() as unknown as GameModule['memory'],
  playerContextBuilder: new WerewolfPlayerContextBuilder(),
  moderatorContextBuilder: new WerewolfModeratorContextBuilder(),
  responseParser: new WerewolfResponseParser(),
  botStrategy: new WerewolfBotStrategy(),
}
