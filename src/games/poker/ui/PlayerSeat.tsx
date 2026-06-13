'use client'

import { memo, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Badge } from '@/frontend/components/ui/badge'
import type { PokerUiPlayer } from '@/frontend/store/match-view-store'
import { PlayingCard } from './PlayingCard'
import { ThinkingBubble } from './ThinkingBubble'

const BUBBLE_DURATION_MS = 4500

export const PlayerSeat = memo(function PlayerSeat({
  player,
  isCurrentActor,
  isDealer,
  blindRole,
  thinking,
}: {
  player: PokerUiPlayer
  isCurrentActor: boolean
  isDealer: boolean
  blindRole?: 'SB' | 'BB'
  thinking?: string
}) {
  const anchorRef = useRef<HTMLDivElement>(null)
  const folded = player.status === 'folded'

  const [bubbleText, setBubbleText] = useState('')
  const [bubbleVisible, setBubbleVisible] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!thinking || thinking.trim().length === 0) return
    setBubbleText(thinking)
    setBubbleVisible(true)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      setBubbleVisible(false)
      timerRef.current = null
    }, BUBBLE_DURATION_MS)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [thinking])

  return (
    <div ref={anchorRef} className={folded ? 'opacity-45' : 'opacity-100'}>
      <motion.div
        className={`flex min-w-64 items-center gap-3 rounded-lg border bg-slate-950/80 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur transition ${
          isCurrentActor ? 'border-cyan-200/70 shadow-[0_0_28px_rgba(34,211,238,0.14)]' : 'border-white/10'
        }`}
        initial={{ y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="truncate text-sm font-semibold text-white">{player.displayName}</div>
            {isDealer ? <Badge variant="secondary">D</Badge> : null}
            {blindRole ? <Badge variant="outline">{blindRole}</Badge> : null}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">筹码 ${player.chips}</div>
          {player.currentBet > 0 ? <div className="text-xs text-primary">下注 ${player.currentBet}</div> : null}
          {player.status !== 'active' ? <div className="text-xs text-muted-foreground">{player.status}</div> : null}
        </div>
        <div className="flex gap-1">
          {player.holeCards.length > 0
            ? player.holeCards.slice(0, 2).map((card) => <PlayingCard key={`${card.rank}-${card.suit}`} card={card} size="sm" />)
            : [0, 1].map((slot) => <PlayingCard key={slot} faceDown size="sm" />)}
        </div>
      </motion.div>
      <ThinkingBubble anchorRef={anchorRef} text={bubbleText} visible={bubbleVisible} />
    </div>
  )
})
