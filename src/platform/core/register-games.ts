import { pokerPlugin } from '@/games/poker/poker-plugin'
import { werewolfPlugin } from '@/games/werewolf/werewolf-plugin'
import { registerGameV2 } from '@/platform/core/registry'

export function registerAllGames(): void {
  // engine2 插件面（spec: docs/specs/engine2-integration.md §2）——GM v2 唯一运行时
  registerGameV2(pokerPlugin)
  registerGameV2(werewolfPlugin)
}
