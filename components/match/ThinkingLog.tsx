'use client'

import { useEffect, useRef } from 'react'
import { useMatchViewStore } from '@/store/match-view-store'

export function ThinkingLog() {
  const thinkingByAgent = useMatchViewStore((state) => state.thinkingByAgent)
  const players = useMatchViewStore((state) => state.players)
  const ref = useRef<HTMLDivElement>(null)
  const entries = Object.entries(thinkingByAgent).filter(([, text]) => text.trim().length > 0)

  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: 'smooth' })
  }, [entries.length])

  return (
    <div ref={ref} className="h-56 overflow-y-auto rounded-2xl border border-border bg-slate-950/45 p-3 text-xs">
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
