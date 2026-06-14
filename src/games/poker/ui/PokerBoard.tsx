'use client'

import type { CSSProperties } from 'react'
import type { CardVisual, PokerSidePot, PokerStreetPots, PokerUiPlayer } from '@/frontend/store/match-view-store'
import { useThinkingStore } from '@/frontend/store/thinking-store'
import { CommunityCards } from './CommunityCards'
import { PlayerSeat } from './PlayerSeat'
import { Pot } from './Pot'

const SEAT_POSITIONS: CSSProperties[] = [
  { bottom: '3%', left: '50%', transform: 'translateX(-50%)' },
  { bottom: '17%', left: '2%' },
  { top: '18%', left: '2%' },
  { top: '3%', left: '50%', transform: 'translateX(-50%)' },
  { top: '18%', right: '2%' },
  { bottom: '17%', right: '2%' },
]

export function PokerBoard({
  players,
  communityCards,
  pot,
  phase,
  currentActor,
  dealerIndex,
  smallBlindIndex,
  bigBlindIndex,
  streetPots,
  sidePots,
}: {
  players: PokerUiPlayer[]
  communityCards: CardVisual[]
  pot: number
  phase: string
  currentActor: string | null
  dealerIndex: number
  smallBlindIndex: number
  bigBlindIndex: number
  streetPots: PokerStreetPots
  sidePots: PokerSidePot[]
}) {
  const currentThinking = useThinkingStore((s) => s.current)
  const thinkingText = (agentId: string) => currentThinking[agentId]?.text
  const blindRole = (seatIndex: number) =>
    seatIndex === smallBlindIndex ? 'SB' : seatIndex === bigBlindIndex ? 'BB' : undefined

  return (
    <>
      {/* Desktop: oval table with 6 absolutely-positioned seats. */}
      <div className="hidden h-full min-h-0 w-full items-center justify-center [container-type:size] lg:flex">
        <div className="relative aspect-[16/10] h-[min(62.5cqw,100cqh)] w-[min(100cqw,160cqh)]">
          <div className="absolute inset-[10%_14%] flex items-center justify-center rounded-[50%] border-[10px] border-amber-900/70 bg-[radial-gradient(circle_at_center,#14532d,#052e16_65%,#04140b)] shadow-2xl shadow-black/50">
            <div className="absolute inset-8 rounded-[50%] border border-cyan-200/10" />
            <div className="relative z-10 flex flex-col items-center gap-4 xl:gap-5">
            <CommunityCards cards={communityCards} />
            <Pot amount={pot} phase={phase} streetPots={streetPots} sidePots={sidePots} />
            </div>
          </div>

          {players.map((player) => (
            <div
              key={player.agentId}
              className="absolute"
              style={SEAT_POSITIONS[player.seatIndex] ?? SEAT_POSITIONS[0]}
            >
              <PlayerSeat
                player={player}
                isCurrentActor={player.agentId === currentActor}
                isDealer={player.seatIndex === dealerIndex}
                blindRole={blindRole(player.seatIndex)}
                thinking={thinkingText(player.agentId)}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Mobile / tablet: stacked list of seats + community cards pinned on top. */}
      <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden lg:hidden">
        <div className="flex shrink-0 flex-col items-center gap-2 rounded-lg border border-white/10 bg-gradient-to-b from-emerald-950/70 to-emerald-950/30 p-2 sm:p-3">
          <CommunityCards cards={communityCards} size="md" />
          <Pot amount={pot} phase={phase} streetPots={streetPots} sidePots={sidePots} compact />
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-2 content-center gap-2 overflow-hidden">
          {[...players]
            .sort((a, b) => a.seatIndex - b.seatIndex)
            .map((player) => (
              <PlayerSeat
                key={player.agentId}
                player={player}
                isCurrentActor={player.agentId === currentActor}
                isDealer={player.seatIndex === dealerIndex}
                blindRole={blindRole(player.seatIndex)}
                thinking={thinkingText(player.agentId)}
                compact
              />
            ))}
        </div>
      </div>
    </>
  )
}
