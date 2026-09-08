import { hasGameV2 } from './core/registry'
import { registerAllGames } from './core/register-games'

let registered = false

export function ensureGamesRegistered(): void {
  if (registered && hasGameV2('poker')) return
  if (!hasGameV2('poker')) registerAllGames()
  registered = true
}
