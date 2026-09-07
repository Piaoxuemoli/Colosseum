'use client'

/**
 * 静态 A2UI surface 渲染核心。
 *
 * 把设计期手写的 SurfaceDefinition + defaults 喂给官方 MessageProcessor（非流式），
 * 捕获生成的 SurfaceModel，交给官方 <A2uiSurface> 渲染。
 * 配置页（A2UIConfigSurface）与组件测试工具（SurfacePlayground）共用本核心。
 *
 * 详见 spec: docs/specs/2026-06-16-a2ui-config-page-design-claude.md（方案 B / D2 / D3）
 */

import { useEffect, useRef, useState } from 'react'
import { MessageProcessor } from '@a2ui/web_core/v0_9'
import type { Catalog, SurfaceModel } from '@a2ui/web_core/v0_9'
import { A2uiSurface } from '@a2ui/react/v0_9'
import type { ReactComponentImplementation } from '@a2ui/react/v0_9'
import type { SurfaceDefaults, SurfaceDefinition } from '@/platform/core/a2ui-types'

export interface StaticA2UISurfaceProps {
  /** 设计期声明的 surface（组件树 + catalog 绑定）。 */
  surface: SurfaceDefinition
  /** 数据模型默认值（JSON Pointer 顶层键 → 值）。 */
  defaults?: SurfaceDefaults
  /** 渲染用的 catalog（含项目自定义组件）。 */
  catalog: Catalog<ReactComponentImplementation>
  /** 用户动作触发时回调（如点提交按钮）；附带当前数据模型快照，避免闭包读到陈旧 state。 */
  onAction?: (action: unknown, data: Record<string, unknown>) => void
  /** 每次动作时回传当前完整数据模型快照。 */
  onDataModel?: (data: Record<string, unknown>) => void
}

/**
 * 从 getClientDataModel() 的返回里取出指定 surface 的数据。
 * 形状可能是 { [surfaceId]: data } 或直接 data，防御性处理。
 */
function extractSurfaceData(
  raw: unknown,
  surfaceId: string,
): Record<string, unknown> {
  if (raw && typeof raw === 'object') {
    const keyed = (raw as Record<string, unknown>)[surfaceId]
    if (keyed && typeof keyed === 'object') {
      return keyed as Record<string, unknown>
    }
    // 某些实现直接返回 data 对象本身
    return raw as Record<string, unknown>
  }
  return {}
}

export function StaticA2UISurface({
  surface,
  defaults,
  catalog,
  onAction,
  onDataModel,
}: StaticA2UISurfaceProps) {
  const [model, setModel] = useState<SurfaceModel<ReactComponentImplementation> | null>(null)

  // 用 ref 承载回调，避免回调变更导致 effect 重建 processor。
  const onActionRef = useRef(onAction)
  const onDataModelRef = useRef(onDataModel)
  onActionRef.current = onAction
  onDataModelRef.current = onDataModel

  useEffect(() => {
    const processor = new MessageProcessor<ReactComponentImplementation>([catalog], (action) => {
      const dm = processor.getClientDataModel()
      const data = dm !== undefined ? extractSurfaceData(dm, surface.surfaceId) : {}
      onDataModelRef.current?.(data)
      onActionRef.current?.(action, data)
    })

    let captured: SurfaceModel<ReactComponentImplementation> | undefined
    const sub = processor.onSurfaceCreated((s) => {
      if (s.id === surface.surfaceId) captured = s
    })

    processor.processMessages([
      {
        version: 'v0.9',
        createSurface: {
          surfaceId: surface.surfaceId,
          catalogId: surface.catalogId,
          sendDataModel: true,
        },
      },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: surface.surfaceId,
          components: surface.components,
        },
      },
      {
        version: 'v0.9',
        updateDataModel: {
          surfaceId: surface.surfaceId,
          path: '',
          value: defaults ?? {},
        },
      },
    ])

    if (captured) setModel(captured)

    return () => {
      sub.unsubscribe()
      captured?.dispose()
    }
  }, [surface, defaults, catalog])

  if (!model) return null
  return <A2uiSurface surface={model} />
}
