/**
 * 游戏注册入口 — 应用启动时调用。
 * 注册所有可用游戏插件到 Registry。
 */

import { registerGame } from '../core/registry/game-registry'
import { pokerPlugin } from './poker/poker-plugin'
import { doudizhuPlugin } from './doudizhu/doudizhu-plugin'

export function registerAllGames(): void {
  registerGame(pokerPlugin)
  registerGame(doudizhuPlugin)
}
