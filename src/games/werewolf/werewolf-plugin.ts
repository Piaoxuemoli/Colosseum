/**
 * 狼人杀游戏包入口（engine2 唯一运行时，spec: docs/specs/engine2-integration.md §8）。
 *
 * v1 插件面（engine/memory/botStrategy/moderatorContextBuilder 等旧引擎装配）
 * 已随 v1 引擎删除；本文件是 `integration/plugin-v2.ts` 的薄再导出。
 * （v1 时代本插件即无 A2UI 配置面字段，此处维持不变。）
 */
import { werewolfPluginV2 } from './integration/plugin-v2'

/** v2 唯一插件面（gameType: 'werewolf'；register-games 经 registry v2 注册）。 */
export const werewolfPlugin = werewolfPluginV2
