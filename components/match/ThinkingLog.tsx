'use client'

import { useEffect, useMemo, useRef } from 'react'
import { useMatchViewStore } from '@/store/match-view-store'
import { useThinkingStore } from '@/store/thinking-store'

const MAX_THINKING_LENGTH = 2000

export function ThinkingLog() {
  const thinkingByAgent = useThinkingStore((s) => s.thinkingByAgent)
  const players = useMatchViewStore((state) => state.players)
  const ref = useRef<HTMLDivElement>(null)

  const entries = useMemo(
    () =>
      Object.entries(thinkingByAgent)
        .map(([agentId, text]) => [agentId, text.length > MAX_THINKING_LENGTH ? `${text.slice(0, MAX_THINKING_LENGTH)}…` : text] as const)
        .filter(([, text]) => text.trim().length > 0),
    [thinkingByAgent],
  )

  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: 'smooth' })
  }, [entries.length])

  return (
    <div ref={ref} className="h-full min-h-0 overflow-y-auto rounded-lg border border-white/10 bg-slate-950/45 p-3 text-xs">
      {entries.length === 0 ? (
        <div className="text-muted-foreground">等待思考流...</div>
      ) : (
        <ul className="space-y-3">
          {entries.map(([agentId, text]) => {
            const player = players.find((item) => item.agentId === agentId)
            return (
              <li key={agentId} className="rounded-xl border-l-2 border-cyan-300 bg-cyan-300/5 px-3 py-2">
                <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-200">
                  {player?.displayName ?? agentId}
                </div>
                <div className="whitespace-pre-wrap text-slate-200">{text}</div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
