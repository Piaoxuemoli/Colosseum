import { useState, useEffect } from 'react'
import { useFloating, autoPlacement, offset, shift } from '@floating-ui/react'
import type { Player } from '../../types/ui'
import { useGameStore } from '../../store/game-store'
import { PlayingCard } from './PlayingCard'
import { ThinkingBubble } from './ThinkingBubble'

// ── Helpers ──

function playerIcon(type: string): string {
  switch (type) {
    case 'human': return 'person'
    case 'llm': return 'smart_toy'
    case 'bot': return 'target'
    default: return 'add'
  }
}

function badgeStyle(badge: string): string {
  switch (badge) {
    case 'D': return 'bg-secondary text-on-secondary'
    case 'SB': return 'bg-tertiary-container text-on-tertiary-container'
    case 'BB': return 'bg-primary-container text-on-primary-container'
    default: return 'bg-surface-container-high text-on-surface'
  }
}

/** Player type → persistent border color (only human and bot show always) */
function typeBorderClass(type: string): string {
  switch (type) {
    case 'human': return 'border-tertiary'
    case 'bot': return 'border-secondary'
    default: return 'border-transparent'
  }
}

/** Chip display color by player type */
function chipColorClass(type: string): string {
  switch (type) {
    case 'human': return 'text-tertiary'
    default: return 'text-on-surface'
  }
}

function parseCardStr(cardStr: string): { rank: string; suit: 'heart' | 'diamond' | 'club' | 'spade' } {
  const suit = cardStr.includes('♥') ? 'heart' as const
    : cardStr.includes('♦') ? 'diamond' as const
    : cardStr.includes('♣') ? 'club' as const
    : 'spade' as const
  return { rank: cardStr.replace(/[♥♦♣♠]/g, ''), suit }
}

function isTopSeat(position: string): boolean {
  return position === 'top' || position === 'top-left' || position === 'top-right'
}

function isLeftSeat(position: string): boolean {
  return position === 'top-left' || position === 'bottom-left'
}

function isRightSeat(position: string): boolean {
  return position === 'top-right' || position === 'bottom-right'
}

// ── Action label colors ──

function actionLabelStyle(actionType: string): string {
  switch (actionType) {
    case 'allIn': return 'bg-gradient-to-r from-red-500 to-orange-600 text-white'
    case 'raise': case 'bet': return 'bg-secondary text-on-secondary'
    case 'call': return 'bg-tertiary/15 text-tertiary'
    case 'check': return 'bg-white/8 text-on-surface-variant'
    case 'fold': return 'bg-error/10 text-error'
    default: return 'bg-surface-container-high text-on-surface-variant'
  }
}

// ── Countdown hook ──

function useThinkingCountdown(): { seconds: number; isUnlimited: boolean } | null {
  const thinkingStartTime = useGameStore(s => s.thinkingStartTime)
  const gameState = useGameStore(s => s.gameState)
  const timeoutMs = gameState?.timingConfig?.thinkingTimeout ?? 30000
  const isUnlimited = timeoutMs === 0
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!thinkingStartTime) return
    const interval = setInterval(() => setNow(Date.now()), 100)
    return () => clearInterval(interval)
  }, [thinkingStartTime])

  if (!thinkingStartTime) return null
  const elapsed = now - thinkingStartTime
  if (isUnlimited) return { seconds: Math.floor(elapsed / 1000), isUnlimited: true }
  const remaining = Math.max(0, timeoutMs - elapsed)
  return { seconds: Math.ceil(remaining / 1000), isUnlimited: false }
}

// ── Bet Chip (inside table felt) ──

interface BetChipProps {
  amount: number
  actionType?: string
}

export function BetChip({ amount, actionType }: BetChipProps) {
  if (amount <= 0) return null
  const isAggressive = actionType === 'raise' || actionType === 'allIn' || actionType === 'bet'
  const chipBg = isAggressive
    ? 'bg-gradient-to-br from-red-400 to-red-600'
    : 'bg-gradient-to-br from-yellow-400 to-yellow-600'
  const textColor = isAggressive ? 'text-red-300' : 'text-secondary'

  return (
    <div className="flex items-center gap-1">
      <div className={`w-4 h-4 rounded-full ${chipBg} border-[1.5px] border-dashed border-white/30 flex items-center justify-center`}>
        <span className="text-[5px] font-black text-white">$</span>
      </div>
      <span className={`text-[11px] font-extrabold ${textColor}`}>${amount}</span>
    </div>
  )
}

// ── Seat positions (absolute, on PokerTable) ──

export const seatPositions: Record<string, string> = {
  bottom: 'absolute -bottom-24 left-1/2 -translate-x-1/2',
  'bottom-right': 'absolute -bottom-4 -right-24',
  'top-right': 'absolute -top-20 -right-16',
  'top-left': 'absolute -top-20 -left-16',
  'bottom-left': 'absolute -bottom-4 -left-24',
  top: 'absolute -top-28 left-1/2 -translate-x-1/2',
}

/** Bet chip positions INSIDE the table felt, near each player's edge */
export const betChipInsidePositions: Record<string, string> = {
  bottom: 'absolute bottom-[26%] left-1/2 -translate-x-1/2',
  'bottom-right': 'absolute bottom-[32%] right-[18%]',
  'top-right': 'absolute top-[32%] right-[16%]',
  'top-left': 'absolute top-[32%] left-[16%]',
  'bottom-left': 'absolute bottom-[32%] left-[18%]',
  top: 'absolute top-[26%] left-1/2 -translate-x-1/2',
}

// ── Action Flash Label ──

function ActionFlashLabel({ action }: { action: { type: string; label: string } }) {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), 1500)
    return () => clearTimeout(timer)
  }, [])

  if (!visible) return null

  return (
    <div className={`absolute bottom-[-14px] left-1/2 -translate-x-1/2 whitespace-nowrap
      ${actionLabelStyle(action.type)} rounded-md px-2 py-0.5 text-[9px] font-bold
      border-2 border-background z-20 animate-[actionBubbleIn_0.3s_ease-out]`}>
      {action.label}
    </div>
  )
}

// ── Cards display (outward from table) ──

function SeatCards({ cards, folded, isHero }: {
  cards: string[] | null
  folded?: boolean
  isHero?: boolean
}) {
  if (!cards || cards.length === 0) return null

  const cardElements = cards.map((c, i) => {
    const { rank, suit } = parseCardStr(c)
    return <PlayingCard key={i} card={{ rank, suit }} mini glow={isHero && i === 0} />
  })

  return (
    <div className={`flex flex-row -space-x-1 ${folded ? 'opacity-30 grayscale' : ''}`}>
      {cardElements}
    </div>
  )
}

// ── Main Seat Component ──

interface SeatProps {
  player: Player
  isHero?: boolean
  mode: 'player' | 'spectator'
}

export function Seat({ player, isHero, mode }: SeatProps) {
  const countdown = useThinkingCountdown()

  const preferredSide = isLeftSeat(player.position) || player.position === 'top' ? 'right' : 'left'
  const showBubble = !!player.thinking && !player.folded && !player.eliminated
  const { refs, floatingStyles } = useFloating({
    open: showBubble,
    placement: preferredSide as 'left' | 'right',
    middleware: [
      offset(14),
      autoPlacement({ allowedPlacements: ['left', 'right', 'top', 'bottom'] }),
      shift({ padding: 8 }),
    ],
  })

  if (player.type === 'empty') {
    return (
      <div className={seatPositions[player.position]}>
        <div className="flex flex-col items-center opacity-30">
          <div className="w-12 h-12 rounded-full border-2 border-dashed border-outline-variant flex items-center justify-center">
            <span className="material-symbols-outlined text-outline-variant text-sm">add</span>
          </div>
        </div>
      </div>
    )
  }

  const isFolded = !!player.folded
  const isEliminated = !!player.eliminated
  const isThinking = !!player.thinking && !isFolded && !isEliminated
  const isAllIn = player.chips === 0 && !isFolded && !isEliminated

  let avatarBorderClass = typeBorderClass(player.type)
  let avatarGlow = ''
  let avatarPulse = ''
  if (isThinking) {
    avatarBorderClass = 'border-primary'
    avatarGlow = 'shadow-[0_0_14px_rgba(161,212,148,0.3)]'
    avatarPulse = 'animate-[activePulse_2s_infinite]'
  } else if (isAllIn) {
    avatarBorderClass = 'border-error'
    avatarGlow = 'shadow-[0_0_12px_rgba(255,180,171,0.25)]'
  }

  const topHalf = isTopSeat(player.position)

  // Avatar element
  const avatarEl = (
    <div className="relative flex-shrink-0" ref={refs.setReference}>
      <div className={`w-14 h-14 rounded-full border-[3px] ${avatarBorderClass} bg-surface-container-high
        flex items-center justify-center ${avatarGlow} ${avatarPulse}
        ${isEliminated ? 'opacity-30 grayscale' : ''}
        ${isFolded ? 'opacity-35 grayscale-[0.6]' : ''}`}>
        <span className="material-symbols-outlined text-[24px] text-on-surface-variant">
          {playerIcon(player.type)}
        </span>
      </div>

      {player.badge && (
        <div className={`absolute -top-[5px] ${topHalf ? '-left-[5px]' : '-right-[5px]'}
          w-5 h-5 rounded-full flex items-center justify-center text-[7px] font-black
          border-2 border-background ${badgeStyle(player.badge)}`}>
          {player.badge}
        </div>
      )}

      {isThinking && (
        <div className="absolute -bottom-[3px] -right-[3px] bg-primary text-on-primary
          rounded-lg h-[18px] px-1 flex items-center gap-0.5 text-[7px] font-bold
          border-2 border-background">
          <span className="material-symbols-outlined text-[10px] animate-spin">sync</span>
          {countdown && (
            <span>{countdown.isUnlimited ? `${countdown.seconds}s` : `${countdown.seconds}s`}</span>
          )}
        </div>
      )}

      {player.lastAction && <ActionFlashLabel action={player.lastAction} />}
    </div>
  )

  // Info element
  const infoEl = (
    <div className={topHalf ? 'text-left' : 'text-right'}>
      <div className={`text-xs font-extrabold truncate max-w-[100px]
        ${isEliminated || isFolded ? 'text-outline-variant' : 'text-on-surface'}
        ${isFolded ? 'line-through' : ''}`}>
        {player.name}
      </div>
      {isEliminated ? (
        <div className="text-[9px] font-bold text-error">已淘汰</div>
      ) : isFolded ? (
        <div className="text-[9px] font-bold text-error">FOLDED</div>
      ) : isAllIn ? (
        <div className="text-[13px] font-black text-error">ALL IN</div>
      ) : (
        <div className={`text-[14px] font-black tabular-nums ${chipColorClass(player.type)}`}>
          ${player.chips.toLocaleString()}
        </div>
      )}
    </div>
  )

  // Cards element (outward direction)
  const cardsEl = (mode === 'spectator' || isHero) ? (
    <SeatCards cards={player.cards} folded={isFolded} isHero={isHero} />
  ) : null

  // Layout: top seats = avatar left + info right, bottom = info left + avatar right
  const seatRow = topHalf
    ? <div className="flex items-center gap-2">{avatarEl}{infoEl}</div>
    : <div className="flex items-center gap-2">{infoEl}{avatarEl}</div>

  // Cards outward: top seats = cards above, bottom = below
  let content: React.ReactNode
  if (isTopSeat(player.position)) {
    content = (
      <div className={`flex flex-col items-center gap-1 ${isLeftSeat(player.position) ? 'items-start' : isRightSeat(player.position) ? 'items-end' : 'items-center'}`}>
        {cardsEl}
        {seatRow}
      </div>
    )
  } else {
    content = (
      <div className={`flex flex-col items-center gap-1 ${isLeftSeat(player.position) ? 'items-end' : isRightSeat(player.position) ? 'items-start' : 'items-center'}`}>
        {seatRow}
        {cardsEl}
      </div>
    )
  }

  return (
    <div className={seatPositions[player.position]}>
      <div className="relative">
        {showBubble && (
          <div ref={refs.setFloating} style={{ ...floatingStyles, zIndex: 50 }}>
            <ThinkingBubble content={player.thinking!} variant="player" />
          </div>
        )}
        {content}
      </div>
    </div>
  )
}

// ── Backward-compatible exports ──

export function PlayerSeat({ player, isHero }: { player: Player; isHero?: boolean }) {
  return <Seat player={player} isHero={isHero} mode="player" />
}

export function SpectatorSeat({ player }: { player: Player }) {
  return <Seat player={player} mode="spectator" />
}
