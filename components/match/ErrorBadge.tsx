'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useMatchViewStore } from '@/store/match-view-store'

type ErrorItem = {
  agentId: string
  layer: string
  errorCode: string
  occurredAt: string
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

  if (errorCount === 0) return null

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-red-300 transition hover:bg-red-500/10">
          <AlertTriangle size={14} />
          <Badge variant="destructive">{errorCount}</Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-red-200">Agent 错误</div>
        <ul className="space-y-2 text-xs">
          {items.slice(0, 5).map((item, index) => (
            <li key={`${item.agentId}-${item.errorCode}-${index}`} className="rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-2">
              <div className="font-mono text-red-200">{item.errorCode}</div>
              <div className="mt-1 text-muted-foreground">
                {item.layer} · {item.agentId}
              </div>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
