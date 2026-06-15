/**
 * 客户端 A2UI 配置注册表。
 *
 * 只 import 各游戏 `.a2ui/` 的轻量配置子集（surface JSON / schema / defaults /
 * handle / manifest），**不**经过 `getGame()`——后者会拉入 engine/memory 等
 * 后端模块，违反前端边界。`.a2ui/` 配置文件本身不依赖引擎，可安全进入客户端 bundle。
 *
 * 新增游戏时，在此注册其 `.a2ui/` 导出即可。
 */

import type { ZodTypeAny } from 'zod'
import type {
  A2UIManifest,
  ConfigHandle,
  SurfaceDefinition,
  SurfaceDefaults,
} from '@/platform/core/a2ui-types'
import pokerSurface from '@/games/poker/.a2ui/surface/match-config.json'
import pokerDefaults from '@/games/poker/.a2ui/data/defaults.json'
import { pokerConfigSchema } from '@/games/poker/.a2ui/data/schema'
import { pokerConfigHandle } from '@/games/poker/.a2ui/handle/submit'
import { pokerConfigManifest } from '@/games/poker/.a2ui/runtime/manifest'

export interface GameA2UIConfig {
  configSurface: SurfaceDefinition
  configDefaults: SurfaceDefaults
  configSchema: ZodTypeAny
  configHandle: ConfigHandle
  configManifest: A2UIManifest
}

const configs: Partial<Record<string, GameA2UIConfig>> = {
  poker: {
    configSurface: pokerSurface as unknown as SurfaceDefinition,
    configDefaults: pokerDefaults as SurfaceDefaults,
    configSchema: pokerConfigSchema,
    configHandle: pokerConfigHandle,
    configManifest: pokerConfigManifest,
  },
}

/** 取某游戏的 A2UI 配置；未接入则返回 undefined（前端回退到旧表单）。 */
export function getGameA2UIConfig(gameType: string): GameA2UIConfig | undefined {
  return configs[gameType]
}
