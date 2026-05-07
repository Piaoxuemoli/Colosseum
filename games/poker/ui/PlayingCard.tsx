'use client'

import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'

export type CardVisual = {
  rank: string
  suit: string
}

const SUIT_SYMBOL: Record<string, string> = {
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
  spades: '♠',
}

const RED_SUITS = new Set(['hearts', 'diamonds'])

export function PlayingCard({
  card,
  faceDown,
  size = 'md',
  className,
}: {
  card?: CardVisual
  faceDown?: boolean
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  const sizeClass = {
    sm: 'h-12 w-8 text-sm',
    md: 'h-16 w-12 text-lg',
    lg: 'h-24 w-16 text-2xl',
  }[size]

  if (faceDown || !card) {
    return (
      <motion.div
        className={cn(
          sizeClass,
          'rounded-lg border border-cyan-200/20 bg-[linear-gradient(135deg,#12345b,#08111f_55%,#2563eb)] shadow-lg shadow-black/30',
          className,
        )}
        initial={{ rotateY: 90, opacity: 0 }}
        animate={{ rotateY: 0, opacity: 1 }}
        transition={{ duration: 0.25 }}
      />
    )
  }

  const isRed = RED_SUITS.has(card.suit)
  return (
    <motion.div
      className={cn(
        sizeClass,
        'flex flex-col items-center justify-center rounded-lg border border-slate-300 bg-slate-50 font-black shadow-lg shadow-black/25',
        isRed ? 'text-red-600' : 'text-slate-950',
        className,
      )}
      initial={{ rotateY: 90, opacity: 0 }}
      animate={{ rotateY: 0, opacity: 1 }}
      transition={{ duration: 0.25 }}
    >
      <div>{card.rank}</div>
      <div>{SUIT_SYMBOL[card.suit] ?? '?'}</div>
    </motion.div>
  )
}
