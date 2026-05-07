'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { Gavel } from 'lucide-react'
import { useMatchViewStore } from '@/store/match-view-store'

export function ModeratorPanel() {
  const list = useMatchViewStore((s) => s.werewolf.moderatorNarration)
  const latest = list[list.length - 1]

  return (
    <div
      className="relative overflow-hidden rounded-xl border-2 border-amber-500/40 bg-gradient-to-br from-amber-900/25 to-neutral-950 p-4 shadow-lg shadow-amber-900/20"
      data-testid="werewolf-moderator-panel"
    >
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.25em] text-amber-300">
        <Gavel size={14} /> 主持人
      </div>
      <div className="min-h-[60px]">
        <AnimatePresence mode="wait">
          {latest ? (
            <motion.div
              key={list.length}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.25 }}
              className="font-serif leading-relaxed text-amber-100"
            >
              <div className="text-[10px] text-amber-400/70">
                Day {latest.day} · {latest.phase}
              </div>
              <div className="mt-1 italic">“{latest.narration}”</div>
            </motion.div>
          ) : (
            <div className="text-xs text-neutral-500">等待开局…</div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
