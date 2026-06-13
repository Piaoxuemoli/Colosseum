import { hasGame } from './core/registry'
import { registerAllGames } from './core/register-games'

let registered = false

export function ensureGamesRegistered(): void {
  if (registered && hasGame('poker')) return
  if (!hasGame('poker')) registerAllGames()
  registered = true
}
