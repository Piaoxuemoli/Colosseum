/**
 * 德扑游戏包入口（engine2 唯一运行时，spec: docs/specs/engine2-integration.md §8）。
 *
 * v1 插件面（engine/memory/botStrategy/responseParser 等旧引擎装配）已随 v1
 * 引擎删除；本文件是 `integration/plugin-v2.ts` 的薄再导出 + A2UI 声明式配置面
 * 导出（字段与 v1 时代一致；`.a2ui/` 目录由 check:surfaces 构建期校验）。
 */
import type { SurfaceDefinition, SurfaceDefaults } from '@/platform/core/a2ui-types'
import { pokerPluginV2 } from './integration/plugin-v2'
// ── A2UI 声明式配置页（设计期手写，构建期打包）──
import matchConfigSurface from './.a2ui/surface/match-config.json'
import pokerDefaults from './.a2ui/data/defaults.json'
import { pokerConfigSchema } from './.a2ui/data/schema'
import { pokerConfigHandle } from './.a2ui/handle/submit'
import { pokerConfigManifest } from './.a2ui/runtime/manifest'

/** v2 唯一插件面（gameType: 'poker'；register-games 经 registry v2 注册）。 */
export const pokerPlugin = pokerPluginV2

// ── A2UI 声明式配置页导出（与 v1 插件面字段语义一致）──
export const configSurface = matchConfigSurface as unknown as SurfaceDefinition
export const configSchema = pokerConfigSchema
export const configDefaults = pokerDefaults as SurfaceDefaults
export const configHandle = pokerConfigHandle
export const configManifest = pokerConfigManifest
