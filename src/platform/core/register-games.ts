import { pokerPlugin } from '@/games/poker/poker-plugin'
import { werewolfPlugin } from '@/games/werewolf/werewolf-plugin'
import { registerGame } from '@/platform/core/registry'

export function registerAllGames(): void {
  registerGame(pokerPlugin)
  registerGame(werewolfPlugin)
}
