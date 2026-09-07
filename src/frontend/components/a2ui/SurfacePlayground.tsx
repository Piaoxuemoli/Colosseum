'use client'

/**
 * A2UI 组件测试工具（游戏壳子）。
 *
 * 左侧：粘贴/编辑 surface JSON。
 * 右侧：用 colosseumCatalog + 官方渲染器实时渲染，校验组件是否正常工作。
 *
 * 详见 spec D5/T5：docs/specs/2026-06-16-a2ui-config-page-design-claude.md
 */

import { useEffect, useMemo, useState } from 'react'
import { StaticA2UISurface } from './static-surface'
import { colosseumCatalog, COLOSSEUM_CATALOG_ID } from './catalog'
import { SurfaceErrorBoundary } from './surface-error-boundary'
import {
  DEFAULT_PLAYGROUND_DEFAULTS,
  DEFAULT_PLAYGROUND_SURFACE,
  DEFAULT_PLAYGROUND_TEXT,
} from './playground-default-surface'
import type { SurfaceDefinition } from '@/platform/core/a2ui-types'

type ParseResult = { ok: true; surface: SurfaceDefinition } | { ok: false; error: string }

function parseSurface(text: string): ParseResult {
  let obj: unknown
  try {
    obj = JSON.parse(text)
  } catch (e) {
    return { ok: false, error: `JSON 解析失败：${(e as Error).message}` }
  }
  if (!obj || typeof obj !== 'object') return { ok: false, error: '根节点必须是对象' }
  const o = obj as Record<string, unknown>
  if (typeof o.surfaceId !== 'string') return { ok: false, error: '缺少字符串字段 surfaceId' }
  if (typeof o.catalogId !== 'string') return { ok: false, error: '缺少字符串字段 catalogId' }
  if (!Array.isArray(o.components)) return { ok: false, error: '缺少数组字段 components' }
  const hasRoot = (o.components as Array<Record<string, unknown>>).some((c) => c?.id === 'root')
  if (!hasRoot) return { ok: false, error: 'components 必须包含 id 为 "root" 的根组件' }
  return { ok: true, surface: o as unknown as SurfaceDefinition }
}

export function SurfacePlayground() {
  const [text, setText] = useState(DEFAULT_PLAYGROUND_TEXT)
  const [debounced, setDebounced] = useState(DEFAULT_PLAYGROUND_TEXT)
  const [lastAction, setLastAction] = useState<unknown>(null)
  const [lastData, setLastData] = useState<Record<string, unknown>>(DEFAULT_PLAYGROUND_DEFAULTS)

  // 稳定的默认值引用（避免触发渲染核心 effect 抖动）
  const defaults = useMemo(() => ({ ...DEFAULT_PLAYGROUND_DEFAULTS }), [])

  // 输入防抖，避免每次按键都重建 surface
  useEffect(() => {
    const t = setTimeout(() => setDebounced(text), 300)
    return () => clearTimeout(t)
  }, [text])

  const parsed = useMemo(() => parseSurface(debounced), [debounced])

  return (
    <div className="grid h-screen grid-cols-1 gap-3 bg-[#070A12] p-3 text-slate-200 lg:grid-cols-2">
      {/* 左：surface 编辑器 */}
      <section className="flex min-h-0 flex-col rounded-xl border border-white/10 bg-white/[0.02]">
        <header className="flex items-center justify-between border-b border-white/10 px-4 py-2">
          <span className="text-sm font-semibold text-slate-100">surface.json（左侧 · 粘贴/编辑）</span>
          <button
            type="button"
            onClick={() => setText(DEFAULT_PLAYGROUND_TEXT)}
            className="rounded-md border border-cyan-500/40 px-2 py-0.5 text-xs text-cyan-300 hover:bg-cyan-500/10"
          >
            重置示例
          </button>
        </header>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          className="min-h-0 flex-1 resize-none bg-transparent p-4 font-mono text-xs leading-relaxed text-slate-200 outline-none"
        />
        <footer className="border-t border-white/10 px-4 py-2 text-xs">
          {parsed.ok ? (
            <span className="text-emerald-400">
              ✓ 解析通过 · {parsed.surface.components.length} 个组件
            </span>
          ) : (
            <span className="text-red-400">✗ {parsed.error}</span>
          )}
        </footer>
      </section>

      {/* 右：实时渲染 */}
      <section className="flex min-h-0 flex-col rounded-xl border border-white/10 bg-white/[0.02]">
        <header className="border-b border-white/10 px-4 py-2 text-sm font-semibold text-slate-100">
          实时渲染（右侧 · catalog: {COLOSSEUM_CATALOG_ID}）
        </header>
        <div className="min-h-0 flex-1 overflow-auto p-5">
          {parsed.ok ? (
            <SurfaceErrorBoundary resetKey={debounced}>
              <StaticA2UISurface
                surface={parsed.surface}
                defaults={defaults}
                catalog={colosseumCatalog}
                onAction={setLastAction}
                onDataModel={setLastData}
              />
            </SurfaceErrorBoundary>
          ) : (
            <div className="text-sm text-slate-500">修复左侧 JSON 以预览渲染。</div>
          )}
        </div>
        <footer className="border-t border-white/10 px-4 py-2">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">最近动作 / 数据模型</div>
          <pre className="mt-1 max-h-28 overflow-auto text-xs text-slate-400">
            {JSON.stringify({ action: lastAction, data: lastData }, null, 2)}
          </pre>
        </footer>
      </section>
    </div>
  )
}

export const PlaygroundRouteMeta = {
  defaultSurface: DEFAULT_PLAYGROUND_SURFACE,
}
