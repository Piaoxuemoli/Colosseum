/**
 * A2UI 共享类型 —— 供游戏包（`.a2ui/`）与前端渲染器共用。
 *
 * 仅类型定义，无运行时依赖（遵守 platform/core 边界：前端只 import 这里的类型）。
 *
 * 设计期声明的静态 surface（非运行时 agent 生成）：游戏开发者在
 * `src/games/<game>/.a2ui/surface/*.json` 手写组件树，构建期静态打包进 GameModule。
 * 详见 spec: docs/superpowers/specs/2026-06-16-a2ui-config-page-design-claude.md
 */

/** A2UI v0.9 单个组件节点：id + 组件名 + 组件特定属性（label/value/children 等）。 */
export interface A2UIComponentNode {
  /** 组件实例 id（surface 内唯一，children 通过 id 引用）。 */
  id: string
  /** 组件名，必须在 catalog 中已注册（如 Column / NumberField / AgentPicker）。 */
  component: string
  /** 组件特定属性（透传给 catalog 适配器）。 */
  [key: string]: unknown
}

/**
 * 静态 A2UI surface：设计期手写的组件树 + catalog 绑定。
 * 渲染器据此构造 `createSurface` + `updateComponents` 消息喂给 MessageProcessor。
 */
export interface SurfaceDefinition {
  /** surface 唯一标识（如 'match-config'）。 */
  surfaceId: string
  /** 绑定的 catalog id（如 'colosseum-basic'）。 */
  catalogId: string
  /** 根组件 id（v0.9 渲染入口；若库按未引用组件推断根，则作为提示）。 */
  root: string
  /** 扁平组件列表（adjacency list：通过 id/children 引用组装树）。 */
  components: A2UIComponentNode[]
}

/** surface 数据模型的默认值（JSON Pointer 顶层键 → 值）。 */
export type SurfaceDefaults = Record<string, unknown>

/** configHandle.submit 的返回：成功带 payload，失败带字段级错误。 */
export type ConfigHandleResult =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; errors: Array<{ path: string; message: string }> }

/**
 * 每游戏提交处理器（`.a2ui/handle/submit.ts`，原 `handle.sh` 的 TS 替代）。
 * 负责：Zod 结构校验 + 跨字段规则 + 转换为 POST payload。
 */
export interface ConfigHandle {
  submit: (data: Record<string, unknown>) => ConfigHandleResult
}

/** 每游戏 A2UI 清单：登记可用 surface + catalog 绑定（供未来多 surface 扩展）。 */
export interface A2UIManifest {
  catalogId: string
  /** 该游戏暴露的 surface id 列表（本轮配置页：['match-config']）。 */
  surfaces: string[]
}
