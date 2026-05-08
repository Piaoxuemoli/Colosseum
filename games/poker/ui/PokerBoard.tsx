'use client'

import type { CSSProperties } from 'react'
import type { CardVisual, PokerUiPlayer } from '@/store/match-view-store'
import { CommunityCards } from './CommunityCards'
import { PlayerSeat } from './PlayerSeat'
import { Pot } from './Pot'

const SEAT_POSITIONS: CSSProperties[] = [
  { bottom: '-7%', left: '50%', transform: 'translateX(-50%)' },
  { bottom: '14%', left: '3%' },
  { top: '18%', left: '0%' },
  { top: '-7%', left: '50%', transform: 'translateX(-50%)' },
  { top: '18%', right: '0%' },
  { bottom: '14%', right: '3%' },
]

export function PokerBoard({
  players,
  communityCards,
  pot,
  phase,
  currentActor,
  dealerIndex,
  thinkingByAgent,
}: {
  players: PokerUiPlayer[]
  communityCards: CardVisual[]
  pot: number
  phase: string
  currentActor: string | null
  dealerIndex: number
  thinkingByAgent: Record<string, string>
}) {
  return (
    <>
      {/* Desktop: oval table with 6 absolutely-positioned seats. */}
      <div className="relative mx-auto hidden aspect-[16/10] w-full max-w-6xl lg:block">
        <div className="absolute inset-[9%] flex items-center justify-center rounded-[50%] border-[10px] border-amber-900/70 bg-[radial-gradient(circle_at_center,#14532d,#052e16_65%,#04140b)] shadow-2xl shadow-black/50">
          <div className="absolute inset-8 rounded-[50%] border border-cyan-200/10" />
          <div className="relative z-10 flex flex-col items-center gap-5">
            <CommunityCards cards={communityCards} />
            <Pot amount={pot} phase={phase} />
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
              thinking={thinkingByAgent[player.agentId]}
            />
          </div>
        ))}
      </div>

      {/* Mobile / tablet: stacked list of seats + community cards pinned on top. */}
      <div className="flex flex-col gap-3 lg:hidden">
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-gradient-to-b from-emerald-950/70 to-emerald-950/30 p-4">
          <CommunityCards cards={communityCards} />
          <Pot amount={pot} phase={phase} />
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {[...players]
            .sort((a, b) => a.seatIndex - b.seatIndex)
            .map((player) => (
              <PlayerSeat
                key={player.agentId}
                player={player}
                isCurrentActor={player.agentId === currentActor}
                isDealer={player.seatIndex === dealerIndex}
                thinking={thinkingByAgent[player.agentId]}
              />
            ))}
        </div>
      </div>
    </>
  )
}
