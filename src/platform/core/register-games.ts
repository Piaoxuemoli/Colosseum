import { pokerPlugin } from '@/games/poker/poker-plugin'
import { werewolfPlugin } from '@/games/werewolf/werewolf-plugin'
import { avalonPluginV2 } from '@/games/avalon/integration/plugin-v2'
import { registerGameV2 } from '@/platform/core/registry'

export function registerAllGames(): void {
  // engine2 插件面（spec: docs/specs/engine2-integration.md §2）——GM v2 唯一运行时
  registerGameV2(pokerPlugin)
  registerGameV2(werewolfPlugin)
  // R3-2 新品类冒烟接入（NFR-08）：仅注册一行，平台核心零分支。
  registerGameV2(avalonPluginV2)
}
