'use client'

import { memo } from 'react'
import { motion } from 'framer-motion'
import type { PokerSidePot, PokerStreetPots } from '@/store/match-view-store'

const STREET_LABEL: Record<string, string> = {
  preflop: '翻前',
  flop: '翻牌',
  turn: '转牌',
  river: '河牌',
}

export const Pot = memo(function Pot({
  amount,
  phase,
  streetPots,
  sidePots,
}: {
  amount: number
  phase: string
  streetPots?: PokerStreetPots
  sidePots?: PokerSidePot[]
}) {
  const streetAmount = streetPots?.[phase as keyof PokerStreetPots] ?? 0
  return (
    <div className="flex flex-col items-center gap-2">
      <motion.div
        initial={{ scale: 1.12 }}
        animate={{ scale: 1 }}
        transition={{ duration: 0.2 }}
        className="rounded-full border border-amber-300/30 bg-amber-300/15 px-5 py-2 font-black text-amber-100 shadow-lg shadow-amber-950/30"
      >
        总底池 ${amount}
      </motion.div>
      <div className="flex flex-wrap justify-center gap-2 text-xs font-semibold text-cyan-100/70">
        <span className="uppercase tracking-[0.25em]">{phase}</span>
        {streetAmount > 0 ? <span>{STREET_LABEL[phase] ?? phase}池 ${streetAmount}</span> : null}
        {sidePots && sidePots.length > 0 ? <span>边池 {sidePots.map((pot) => `$${pot.amount}`).join(' / ')}</span> : null}
      </div>
    </div>
  )
})
