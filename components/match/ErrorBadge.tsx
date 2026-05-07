'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useMatchViewStore } from '@/store/match-view-store'

type ErrorItem = {
  agentId: string
  layer: string
  errorCode: string
  occurredAt: string
  rawResponse?: string | null
}

export function ErrorBadge({ matchId }: { matchId: string }) {
  const errorCount = useMatchViewStore((state) => state.errorCount)
  const setErrorCount = useMatchViewStore((state) => state.setErrorCount)
  const [items, setItems] = useState<ErrorItem[]>([])

  useEffect(() => {
    let cancelled = false

    async function refresh() {
      const res = await fetch(`/api/matches/${matchId}/errors`)
      if (!res.ok) return
      const json = (await res.json()) as { count: number; errors: ErrorItem[] }
      if (cancelled) return
      setItems(json.errors)
      setErrorCount(json.count)
    }

    void refresh()
    const timer = setInterval(() => void refresh(), 5_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [matchId, setErrorCount])

  const groups = useMemo(() => {
    const out = new Map<string, ErrorItem[]>()
    for (const item of items) {
      const list = out.get(item.errorCode) ?? []
      list.push(item)
      out.set(item.errorCode, list)
    }
    return Array.from(out.entries()).sort((a, b) => b[1].length - a[1].length)
  }, [items])

  if (errorCount === 0) return null

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-red-300 transition hover:bg-red-500/10">
          <AlertTriangle size={14} />
          <Badge variant="destructive">{errorCount}</Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-[400px] w-96 overflow-y-auto">
        <div className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-red-200">
          Agent 错误分布
        </div>
        {groups.length === 0 ? (
          <div className="text-xs text-muted-foreground">暂无错误</div>
        ) : (
          <ul className="space-y-2">
            {groups.map(([code, list]) => (
              <li key={code}>
                <details>
                  <summary className="cursor-pointer text-xs text-red-300">
                    <span className="font-mono">{code}</span>
                    <span className="ml-2 text-muted-foreground">× {list.length}</span>
                  </summary>
                  <ul className="mt-1 space-y-1 text-[11px]">
                    {list.slice(0, 5).map((item, i) => (
                      <li
                        key={`${item.agentId}-${i}`}
                        className="rounded-lg border border-red-400/20 bg-red-500/10 px-2 py-1"
                      >
                        <div className="text-muted-foreground">
                          <span>{item.layer}</span> · <span>{item.agentId}</span>
                        </div>
                        {item.rawResponse ? (
                          <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap text-muted-foreground">
                            {String(item.rawResponse).slice(0, 400)}
                          </pre>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  )
}
