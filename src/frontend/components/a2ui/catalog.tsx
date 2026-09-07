'use client'

/**
 * colosseumCatalog —— 项目级 A2UI Catalog（编译期契约）。
 *
 * = 官方 basicCatalog（Column/Row/Card/Text/Button/TextField/NumberField/... 标准件）
 *   + 项目自定义组件（AgentPicker / KeyCheckPanel，演示扩展路径）。
 *
 * 自定义组件的 schema 用 zod3（npm alias = zod 3.25.76），与 @a2ui/web_core 内部
 * 绑定的 zod 3 同版本，保证 ComponentApi.schema 类型一致（spec D12）。
 */

import { basicCatalog, createComponentImplementation } from '@a2ui/react/v0_9'
import type { ReactComponentImplementation } from '@a2ui/react/v0_9'
import { Catalog } from '@a2ui/web_core/v0_9'
import { z } from 'zod3'

export const COLOSSEUM_CATALOG_ID = 'colosseum-basic'

// ── 自定义组件：AgentPicker（stub，演示自定义 catalog 注册）──
// 真实版会按 gameType 拉 /api/agents 选 N 名选手；此处先渲染占位。
const agentPickerApi = {
  name: 'AgentPicker',
  schema: z
    .object({
      gameType: z.string().optional(),
      maxCount: z.number().optional(),
      label: z.string().optional(),
    })
    .passthrough(),
}
export const AgentPicker = createComponentImplementation(
  agentPickerApi,
  function AgentPicker({ props }) {
    return (
      <div className="rounded-lg border border-cyan-500/30 bg-cyan-950/20 p-3">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-cyan-300/80">
          AgentPicker
        </div>
        <div className="mt-1 text-sm text-slate-200">
          {props.label ?? '选择选手'}
          {props.maxCount != null ? `（${props.maxCount} 位）` : ''}
          {props.gameType ? ` · ${props.gameType}` : ''}
        </div>
      </div>
    )
  },
)

// ── 自定义组件：KeyCheckPanel（stub）──
// 真实版检查 API key 状态；此处先渲染占位。
const keyCheckApi = {
  name: 'KeyCheckPanel',
  schema: z.object({ label: z.string().optional() }).passthrough(),
}
export const KeyCheckPanel = createComponentImplementation(
  keyCheckApi,
  function KeyCheckPanel({ props }) {
    return (
      <div className="rounded-lg border border-amber-500/30 bg-amber-950/20 p-3">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-amber-300/80">
          KeyCheckPanel
        </div>
        <div className="mt-1 text-sm text-slate-200">{props.label ?? 'API Key 状态检查'}</div>
      </div>
    )
  },
)

// ── 组装 colosseumCatalog：basicCatalog 标准件 + 项目自定义组件 ──
const standardComponents = Array.from(basicCatalog.components.values())

export const colosseumCatalog: Catalog<ReactComponentImplementation> = new Catalog(
  COLOSSEUM_CATALOG_ID,
  [...standardComponents, AgentPicker, KeyCheckPanel],
)

/** catalog 已注册的组件名集合（供 surface 构建期校验器复用）。 */
export const colosseumComponentNames: readonly string[] = [
  ...basicCatalog.components.keys(),
  'AgentPicker',
  'KeyCheckPanel',
]
