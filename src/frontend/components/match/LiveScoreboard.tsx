'use client'

import { Crown } from 'lucide-react'
import { useMatchViewStore } from '@/frontend/store/match-view-store'

export function LiveScoreboard() {
  const players = useMatchViewStore((state) => state.players)
  const chipHistory = useMatchViewStore((state) => state.chipHistory)
  const previous = chipHistory.at(-2)?.chips ?? chipHistory.at(-1)?.chips ?? {}
  const sorted = [...players].sort((a, b) => b.chips - a.chips)

  return (
    <div className="flex h-full min-h-0 flex-col rounded-lg border border-white/10 bg-slate-950/45 p-3">
      <div className="mb-2 shrink-0 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">实时排名</div>
      <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
        {sorted.map((player, index) => {
          const delta = previous[player.agentId] === undefined ? 0 : player.chips - previous[player.agentId]
          return (
            <li
              key={player.agentId}
              className="flex items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-cyan-300/5"
            >
              <div className="w-5 text-xs text-muted-foreground">{index + 1}</div>
              <div className="min-w-0 flex-1 truncate">{player.displayName}</div>
              {index === 0 ? <Crown aria-label="leader" size={14} className="text-yellow-300" /> : null}
              <div className="font-mono text-sm text-cyan-50">{player.chips}</div>
              {delta !== 0 ? (
                <div className={`font-mono text-xs ${delta > 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                  {delta > 0 ? '+' : ''}
                  {delta}
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
