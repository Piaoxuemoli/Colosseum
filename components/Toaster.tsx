'use client'

import { useToastStore } from '@/lib/client/toast'

/**
 * Fixed toast stack rendered in the top-right. Mounts once from the root
 * layout; reads from the `useToastStore` zustand store so any client
 * component can call `toast.error(...)` without props drilling.
 */
export function Toaster() {
  const items = useToastStore((s) => s.items)
  const dismiss = useToastStore((s) => s.dismiss)

  if (items.length === 0) return null

  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[100] flex w-80 max-w-[90vw] flex-col gap-2">
      {items.map((t) => {
        const color =
          t.kind === 'error'
            ? 'border-red-500/40 bg-red-500/15 text-red-50'
            : t.kind === 'success'
              ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-50'
              : 'border-cyan-500/40 bg-cyan-500/15 text-cyan-50'
        return (
          <div
            key={t.id}
            role="alert"
            className={`pointer-events-auto rounded-lg border px-3 py-2 text-sm shadow-xl backdrop-blur ${color}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold">{t.title}</div>
                {t.description ? (
                  <div className="mt-1 break-words text-xs opacity-80">{t.description}</div>
                ) : null}
              </div>
              <button
                type="button"
                aria-label="关闭"
                className="text-sm opacity-70 hover:opacity-100"
                onClick={() => dismiss(t.id)}
              >
                ×
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
