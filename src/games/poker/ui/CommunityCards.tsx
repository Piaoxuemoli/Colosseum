'use client'

import { memo } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { PlayingCard, type CardVisual } from './PlayingCard'

export const CommunityCards = memo(function CommunityCards({ cards }: { cards: CardVisual[] }) {
  return (
    <div className="flex min-h-28 items-center justify-center gap-2">
      <AnimatePresence>
        {cards.map((card) => (
          <motion.div
            key={`${card.rank}-${card.suit}`}
            initial={{ y: -40, opacity: 0, rotate: -3 }}
            animate={{ y: 0, opacity: 1, rotate: 0 }}
            transition={{ duration: 0.28 }}
          >
            <PlayingCard card={card} size="lg" />
          </motion.div>
        ))}
      </AnimatePresence>
      {Array.from({ length: Math.max(0, 5 - cards.length) }).map((_, index) => (
        <PlayingCard key={`empty-${index}`} faceDown size="lg" className="opacity-25" />
      ))}
    </div>
  )
})
