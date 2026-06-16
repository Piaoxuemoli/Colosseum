'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { Gavel, Skull } from 'lucide-react'
import { useMatchViewStore } from '@/frontend/store/match-view-store'

const DEATH_LABEL: Record<string, string> = {
  werewolfKill: '夜刀',
  witchPoison: '毒杀',
  vote: '票出',
}

export function ModeratorPanel() {
  const list = useMatchViewStore((s) => s.werewolf.moderatorNarration)
  const deaths = useMatchViewStore((s) => s.werewolf.deaths)
  const players = useMatchViewStore((s) => s.players)
  const latest = list[list.length - 1]

  const nameOf = (agentId: string) =>
    players.find((p) => p.agentId === agentId)?.displayName ?? agentId

  // 最近 2 名出局者（公告流入 ww.deaths）。
  const recentDeaths = deaths.slice(-2)

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
      {recentDeaths.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-amber-500/20 pt-2 text-[11px] text-amber-200/80">
          <Skull size={12} aria-hidden="true" />
          <span>出局：</span>
          {recentDeaths.map((d) => (
            <span key={d.agentId} className="rounded bg-amber-500/10 px-1.5 py-0.5">
              {nameOf(d.agentId)}
              {d.cause ? <span className="ml-1 text-amber-400/70">{DEATH_LABEL[d.cause] ?? d.cause}</span> : null}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}
