'use client'

import { memo, useEffect, useRef, useState } from 'react'
import type { Placement } from '@floating-ui/react'
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
  compact = false,
}: {
  player: PokerUiPlayer
  isCurrentActor: boolean
  isDealer: boolean
  blindRole?: 'SB' | 'BB'
  thinking?: string
  compact?: boolean
}) {
  const anchorRef = useRef<HTMLDivElement>(null)
  const folded = player.status === 'folded'
  const eliminated = player.status === 'eliminated'
  const bubblePlacement: Placement =
    player.seatIndex === 0 ? 'top' : player.seatIndex === 3 ? 'bottom' : player.seatIndex < 3 ? 'right' : 'left'

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

  const statusLabel =
    player.status === 'eliminated'
      ? '已淘汰'
      : player.status === 'sittingOut'
        ? '离场'
        : player.status === 'allIn'
          ? 'all-in'
          : player.status === 'folded'
            ? '弃牌'
            : null

  return (
    <div className={folded || eliminated ? 'opacity-45' : 'opacity-100'}>
      <motion.div
        ref={anchorRef}
        className={`flex w-full min-w-0 items-center rounded-lg border bg-slate-950/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur transition lg:w-[clamp(11.5rem,18vw,16rem)] lg:max-w-[16rem] ${
          compact ? 'gap-2 p-2' : 'gap-3 p-3'
        } ${
          isCurrentActor && !eliminated
            ? 'border-cyan-200/70 shadow-[0_0_28px_rgba(34,211,238,0.14)]'
            : 'border-white/10'
        } ${eliminated ? 'grayscale' : ''}`}
        initial={{ y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className={`${compact ? 'text-xs' : 'text-sm'} truncate font-semibold text-white`}>{player.displayName}</div>
            {isDealer ? <Badge variant="secondary">D</Badge> : null}
            {blindRole ? <Badge variant="outline">{blindRole}</Badge> : null}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">筹码 ${player.chips}</div>
          {player.currentBet > 0 ? <div className="text-xs text-primary">下注 ${player.currentBet}</div> : null}
          {statusLabel ? <div className="text-xs text-muted-foreground">{statusLabel}</div> : null}
        </div>
        <div className="flex shrink-0 gap-1">
          {!eliminated && player.holeCards.length > 0
            ? player.holeCards.slice(0, 2).map((card) => <PlayingCard key={`${card.rank}-${card.suit}`} card={card} size="sm" />)
            : null}
          {!eliminated && player.holeCards.length === 0
            ? [0, 1].map((slot) => <PlayingCard key={slot} faceDown size="sm" />)
            : null}
        </div>
      </motion.div>
      {!eliminated && (
        <ThinkingBubble anchorRef={anchorRef} text={bubbleText} visible={bubbleVisible} placement={bubblePlacement} />
      )}
    </div>
  )
})
