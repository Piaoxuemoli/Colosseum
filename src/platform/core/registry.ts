import type { GameModuleV2 } from '@/platform/engine/contracts-v2'
import type { GameType } from './types'

/**
 * 游戏插件注册表（v2 唯一插件面，spec: docs/specs/engine2-integration.md §2）。
 *
 * 旧 `GameModule`（engine/botStrategy/responseParser 等装配）已随 v1 引擎
 * 删除；存储类型为 `GameModuleV2<unknown, unknown>`：契约成员均为方法语法
 * （双变），各游戏的具体泛型模块可无断言注册。
 */
const registryV2 = new Map<GameType, GameModuleV2<unknown, unknown>>()

export function registerGameV2(module: GameModuleV2<unknown, unknown>): void {
  registryV2.set(module.gameType, module)
}

export function getGameV2(gameType: GameType): GameModuleV2<unknown, unknown> {
  const module = registryV2.get(gameType)
  if (!module) throw new Error(`gameType v2 module not registered: ${gameType}`)
  return module
}

export function hasGameV2(gameType: GameType): boolean {
  return registryV2.has(gameType)
}

export function clearRegistry(): void {
  registryV2.clear()
}
