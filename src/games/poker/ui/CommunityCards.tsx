'use client'

import { memo } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { PlayingCard, type CardVisual } from './PlayingCard'

export const CommunityCards = memo(function CommunityCards({
  cards,
  size = 'lg',
}: {
  cards: CardVisual[]
  size?: 'md' | 'lg'
}) {
  const minHeightClass = size === 'lg' ? 'min-h-28' : 'min-h-16'

  return (
    <div className={`flex ${minHeightClass} items-center justify-center gap-1.5 sm:gap-2`}>
      <AnimatePresence>
        {cards.map((card) => (
          <motion.div
            key={`${card.rank}-${card.suit}`}
            initial={{ y: -40, opacity: 0, rotate: -3 }}
            animate={{ y: 0, opacity: 1, rotate: 0 }}
            transition={{ duration: 0.28 }}
          >
            <PlayingCard card={card} size={size} />
          </motion.div>
        ))}
      </AnimatePresence>
      {Array.from({ length: Math.max(0, 5 - cards.length) }).map((_, index) => (
        <PlayingCard key={`empty-${index}`} faceDown size={size} className="opacity-25" />
      ))}
    </div>
  )
})
