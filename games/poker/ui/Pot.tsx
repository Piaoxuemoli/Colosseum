'use client'

import { motion } from 'framer-motion'

export function Pot({ amount, phase }: { amount: number; phase: string }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <motion.div
        key={amount}
        initial={{ scale: 1.12 }}
        animate={{ scale: 1 }}
        transition={{ duration: 0.2 }}
        className="rounded-full border border-amber-300/30 bg-amber-300/15 px-5 py-2 font-black text-amber-100 shadow-lg shadow-amber-950/30"
      >
        底池 ${amount}
      </motion.div>
      <div className="text-xs font-semibold uppercase tracking-[0.25em] text-cyan-100/60">{phase}</div>
    </div>
  )
}
