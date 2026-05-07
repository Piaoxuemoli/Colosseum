'use client'

import { Crown } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { useMatchViewStore } from '@/store/match-view-store'

export function LiveScoreboard() {
  const players = useMatchViewStore((state) => state.players)
  const chipHistory = useMatchViewStore((state) => state.chipHistory)
  const previous = chipHistory.at(-2)?.chips ?? chipHistory.at(-1)?.chips ?? {}
  const sorted = [...players].sort((a, b) => b.chips - a.chips)

  return (
    <div className="rounded-2xl border border-border bg-slate-950/45 p-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">实时排名</div>
      <ul className="space-y-1">
        <AnimatePresence>
          {sorted.map((player, index) => {
            const delta = previous[player.agentId] === undefined ? 0 : player.chips - previous[player.agentId]
            return (
              <motion.li
                key={player.agentId}
                layout
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-2 rounded-xl px-2 py-2 text-sm hover:bg-cyan-300/5"
              >
                <div className="w-5 text-xs text-muted-foreground">{index + 1}</div>
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-cyan-300/15 text-sm">
                  {player.avatarEmoji}
                </div>
                <div className="min-w-0 flex-1 truncate">{player.displayName}</div>
                {index === 0 ? <Crown aria-label="leader" size={14} className="text-yellow-300" /> : null}
                <div className="font-mono text-sm text-cyan-50">{player.chips}</div>
                {delta !== 0 ? (
                  <div className={`font-mono text-xs ${delta > 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                    {delta > 0 ? '+' : ''}
                    {delta}
                  </div>
                ) : null}
              </motion.li>
            )
          })}
        </AnimatePresence>
      </ul>
    </div>
  )
}
