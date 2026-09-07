'use client'

/**
 * A2UI 声明式配置页封装。
 *
 * 读 GameModule.config*，用官方渲染器渲染 surface；用户点提交时：
 * configHandle.submit(data)（Zod 结构校验 + 跨字段规则）→ 成功回调 onSubmit(payload)，
 * 失败则展示字段级错误。详见 spec D7 / T4。
 */

import { useState } from 'react'
import { StaticA2UISurface } from './static-surface'
import { colosseumCatalog } from './catalog'
import type { ConfigHandle, SurfaceDefaults, SurfaceDefinition } from '@/platform/core/a2ui-types'
import type { Catalog } from '@a2ui/web_core/v0_9'
import type { ReactComponentImplementation } from '@a2ui/react/v0_9'

export interface A2UIConfigSurfaceProps {
  configSurface: SurfaceDefinition
  configDefaults?: SurfaceDefaults
  configHandle?: ConfigHandle
  /** 自定义 catalog；默认用 colosseumCatalog。 */
  catalog?: Catalog<ReactComponentImplementation>
  /** 校验通过后回调（payload 形如 POST /api/matches 的请求体）。 */
  onSubmit: (payload: Record<string, unknown>) => void | Promise<void>
}

/** 从 A2UI 动作里安全取 event name（兼容 {event:{name}} 与 {name} 两种形态）。 */
function actionName(action: unknown): string | undefined {
  if (action && typeof action === 'object') {
    const a = action as Record<string, unknown>
    const evt = a.event
    if (evt && typeof evt === 'object') {
      const n = (evt as Record<string, unknown>).name
      if (typeof n === 'string') return n
    }
    if (typeof a.name === 'string') return a.name
  }
  return undefined
}

export function A2UIConfigSurface({
  configSurface,
  configDefaults,
  configHandle,
  catalog = colosseumCatalog,
  onSubmit,
}: A2UIConfigSurfaceProps) {
  const [errors, setErrors] = useState<Array<{ path: string; message: string }>>([])

  function handleAction(action: unknown, data: Record<string, unknown>) {
    if (actionName(action) !== 'submit') return
    if (!configHandle) {
      setErrors([])
      void onSubmit(data)
      return
    }
    const result = configHandle.submit(data)
    if (result.ok) {
      setErrors([])
      void onSubmit(result.payload)
    } else {
      setErrors(result.errors)
    }
  }

  return (
    <div className="space-y-4">
      <StaticA2UISurface
        surface={configSurface}
        defaults={configDefaults}
        catalog={catalog}
        onAction={handleAction}
      />
      {errors.length > 0 ? (
        <div className="rounded-lg border border-red-500/40 bg-red-950/20 p-3 text-sm text-red-200">
          <div className="font-semibold">校验失败</div>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-red-300/80">
            {errors.map((e, i) => (
              <li key={`${e.path}-${i}`}>
                <span className="font-mono">{e.path}</span>：{e.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
