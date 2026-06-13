import type { Player, CardData } from '../../types/ui'
import type { SidePot } from '../../types/game'
import { CommunityCards } from './CommunityCards'
import { PotDisplay } from './PotDisplay'
import { PlayerSeat, SpectatorSeat, BetChip, betChipInsidePositions } from './PlayerSeat'

interface PokerTableProps {
  players: Player[]
  communityCards: CardData[]
  pot: number
  sidePots?: SidePot[]
  mode: 'player' | 'spectator'
  heroId?: string
  phase?: string
}

const phaseColors: Record<string, { cls: string; icon: string }> = {
  '翻前': { cls: 'bg-surface-container-high text-on-surface-variant', icon: 'playing_cards' },
  '翻牌': { cls: 'bg-primary-container/30 text-primary', icon: 'style' },
  '转牌': { cls: 'bg-tertiary-container/30 text-tertiary', icon: 'transition_fade' },
  '河牌': { cls: 'bg-secondary-container/30 text-secondary', icon: 'water' },
  '摊牌': { cls: 'bg-error/20 text-error', icon: 'visibility' },
}

export function PokerTable({ players, communityCards, pot, sidePots, mode, heroId, phase }: PokerTableProps) {
  const isSpectator = mode === 'spectator'

  return (
    <div className="relative w-full max-w-7xl aspect-[2/1] flex items-center justify-center">
      {/* The felt table */}
      <div
        className={`absolute inset-0 ${
          isSpectator
            ? 'poker-table-gradient-spectator rounded-[200px] border border-outline-variant/10'
            : 'poker-table-gradient rounded-[200px]'
        } shadow-2xl flex items-center justify-center`}
      >
        {/* Phase indicator */}
        {phase && (
          <div className={`absolute top-6 left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest flex items-center gap-1.5 ${phaseColors[phase]?.cls || 'bg-surface-container-high text-on-surface-variant'}`}>
            <span className="material-symbols-outlined text-sm">{phaseColors[phase]?.icon || 'playing_cards'}</span>
            {phase}
          </div>
        )}

        {/* Pot display */}
        <div className={isSpectator
          ? 'absolute top-[15%] left-1/2 -translate-x-1/2 -translate-y-full'
          : 'absolute top-[15%]'
        }>
          <PotDisplay amount={pot} sidePots={sidePots} variant={isSpectator ? 'glass' : 'text'} />
        </div>

        {/* Community cards */}
        <CommunityCards cards={communityCards} detailed={isSpectator} />

        {/* Bet chips INSIDE the table felt */}
        {players.map((player) => {
          if (!player.currentBet || player.currentBet <= 0 || player.folded || player.type === 'empty') return null
          const posClass = betChipInsidePositions[player.position]
          if (!posClass) return null
          return (
            <div key={`bet-${player.id}`} className={posClass}>
              <BetChip amount={player.currentBet} actionType={player.lastAction?.type} />
            </div>
          )
        })}
      </div>

      {/* Player seats */}
      {players.map((player) =>
        isSpectator ? (
          <SpectatorSeat key={player.id} player={player} />
        ) : (
          <PlayerSeat
            key={player.id}
            player={player}
            isHero={player.id === heroId}
          />
        ),
      )}
    </div>
  )
}
