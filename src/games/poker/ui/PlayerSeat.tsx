'use client'

import { memo, useEffect, useRef, useState } from 'react'
import type { Placement } from '@floating-ui/react'
import { motion } from 'framer-motion'
import { LoaderCircle } from 'lucide-react'
import { Badge } from '@/frontend/components/ui/badge'
import { ThinkingBubble } from '@/frontend/components/match/ThinkingBubble'
import type { PokerUiPlayer } from '@/frontend/store/match-view-store'
import { PlayingCard } from './PlayingCard'
import {
  bubblePlacementForSeat,
  shouldKeepBubbleOpen,
  THINKING_BUBBLE_VISIBLE_MS,
} from './thinking-bubble-layout'

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
  const folded = player.status === 'folded'
  const eliminated = player.status === 'eliminated'
  const bubblePlacement: Placement = bubblePlacementForSeat(player.seatIndex, compact)
  const isThinking = !eliminated && typeof thinking === 'string' && thinking.trim().length > 0

  const [bubbleText, setBubbleText] = useState('')
  const [bubbleVisible, setBubbleVisible] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const text = thinking?.trim() ?? ''
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (!text) {
      setBubbleVisible(false)
      setBubbleText('')
      return
    }

    const updatedAt = Date.now()
    setBubbleText(text)
    setBubbleVisible(true)
    timerRef.current = setTimeout(() => {
      setBubbleVisible((visible) =>
        shouldKeepBubbleOpen({
          text,
          visible,
          lastUpdatedAt: updatedAt,
          now: Date.now(),
        }),
      )
      timerRef.current = null
    }, THINKING_BUBBLE_VISIBLE_MS)
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
    <div className="relative">
      {isThinking ? (
        <div className="absolute bottom-full left-1/2 z-30 mb-2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-cyan-200/25 bg-slate-950/90 px-2.5 py-1 text-[10px] font-semibold text-cyan-100 shadow-lg shadow-cyan-950/30 backdrop-blur">
          <LoaderCircle size={12} className="animate-spin text-cyan-200" aria-hidden="true" />
          <span>思考中</span>
        </div>
      ) : null}
      <motion.div
        className={`flex w-full min-w-0 items-center rounded-lg border bg-slate-950/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur transition lg:w-[clamp(11.5rem,18vw,16rem)] lg:max-w-[16rem] ${
          compact ? 'gap-2 p-2' : 'gap-3 p-3'
        } ${
          isCurrentActor && !eliminated
            ? 'border-cyan-200/70 shadow-[0_0_28px_rgba(34,211,238,0.14)]'
            : 'border-white/10'
        } ${eliminated ? 'grayscale' : ''} ${folded || eliminated ? 'opacity-45' : 'opacity-100'}`}
        initial={{ y: 10 }}
        animate={{ y: 0 }}
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
        <ThinkingBubble text={bubbleText} visible={bubbleVisible} placement={bubblePlacement} compact={compact} />
      )}
    </div>
  )
})
