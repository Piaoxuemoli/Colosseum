/**
 * GameRegistry — 游戏插件注册表。
 * registerGame() 注册插件，getGame() 取出插件。
 */

import type { GamePlugin } from '../protocols/plugin.protocol'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPlugin = GamePlugin<any, any, any>

const registry = new Map<string, AnyPlugin>()

/** 注册一个游戏插件 */
export function registerGame(plugin: AnyPlugin): void {
  if (registry.has(plugin.gameType)) {
    console.warn(`[GameRegistry] overwriting existing plugin: ${plugin.gameType}`)
  }
  registry.set(plugin.gameType, plugin)
}

/** 获取已注册的游戏插件 */
export function getGame(gameType: string): AnyPlugin {
  const plugin = registry.get(gameType)
  if (!plugin) {
    throw new Error(`[GameRegistry] game type not registered: ${gameType}`)
  }
  return plugin
}

/** 获取所有已注册的游戏类型 */
export function getRegisteredGameTypes(): string[] {
  return Array.from(registry.keys())
}

/** 获取所有已注册的游戏插件 */
export function getAllPlugins(): AnyPlugin[] {
  return Array.from(registry.values())
}

/** 清空注册表（仅测试用） */
export function clearRegistry(): void {
  registry.clear()
}
