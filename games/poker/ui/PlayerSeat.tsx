'use client'

import { useRef } from 'react'
import { motion } from 'framer-motion'
import { Badge } from '@/components/ui/badge'
import type { PokerUiPlayer } from '@/store/match-view-store'
import { PlayingCard } from './PlayingCard'
import { ThinkingBubble } from './ThinkingBubble'

export function PlayerSeat({
  player,
  isCurrentActor,
  isDealer,
  thinking,
}: {
  player: PokerUiPlayer
  isCurrentActor: boolean
  isDealer: boolean
  thinking?: string
}) {
  const anchorRef = useRef<HTMLDivElement>(null)
  const folded = player.status === 'folded'

  return (
    <div ref={anchorRef} className={folded ? 'opacity-45' : 'opacity-100'}>
      <motion.div
        className={`flex min-w-64 items-center gap-3 rounded-2xl border-2 bg-slate-950/80 p-3 shadow-xl shadow-black/30 backdrop-blur transition ${
          isCurrentActor ? 'animate-pulse border-amber-300' : 'border-slate-700/80'
        }`}
        initial={{ y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
      >
        <div className="text-4xl">{player.avatarEmoji}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="truncate text-sm font-semibold text-white">{player.displayName}</div>
            {isDealer ? <Badge variant="secondary">D</Badge> : null}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">筹码 ${player.chips}</div>
          {player.currentBet > 0 ? <div className="text-xs text-amber-200">下注 ${player.currentBet}</div> : null}
          {player.status !== 'active' ? <div className="text-xs text-cyan-100/70">{player.status}</div> : null}
        </div>
        <div className="flex gap-1">
          {player.holeCards.length > 0
            ? player.holeCards.slice(0, 2).map((card) => <PlayingCard key={`${card.rank}-${card.suit}`} card={card} size="sm" />)
            : [0, 1].map((slot) => <PlayingCard key={slot} faceDown size="sm" />)}
        </div>
      </motion.div>
      <ThinkingBubble anchorRef={anchorRef} text={thinking ?? ''} visible={Boolean(thinking) || isCurrentActor} />
    </div>
  )
}
