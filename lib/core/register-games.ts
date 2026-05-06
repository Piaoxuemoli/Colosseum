import { pokerPlugin } from '@/games/poker/poker-plugin'
import { registerGame } from '@/lib/core/registry'

export function registerAllGames(): void {
  registerGame(pokerPlugin)
}
