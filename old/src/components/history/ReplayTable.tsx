import type { HandHistoryEntry } from '../../types/ui'
import { CommunityCards } from '../game/CommunityCards'

interface ReplayTableProps {
  hand: HandHistoryEntry
  currentStep: number
}

/** Generate a mini player display for replay */
function MiniPlayer({ name, isWinner }: { name: string; isWinner: boolean }) {
  return (
    <div
      className={`flex flex-col items-center ${isWinner ? 'text-secondary' : 'text-on-surface-variant'}`}
    >
      <div
        className={`w-10 h-10 rounded-full bg-surface-container-high flex items-center justify-center border-2 ${
          isWinner ? 'border-secondary shadow-[0_0_12px_rgba(233,195,73,0.3)]' : 'border-outline-variant/30'
        }`}
      >
        <span className="material-symbols-outlined text-sm">smart_toy</span>
      </div>
      <span className="text-[9px] font-bold mt-1 max-w-[60px] truncate">{name}</span>
    </div>
  )
}

export function ReplayTable({ hand, currentStep }: ReplayTableProps) {
  const step = hand.steps[currentStep]
  const cards = step?.communityCards ?? [null, null, null, null, null]

  // Position mini players around
  const positions = [
    'absolute -top-6 left-1/4 -translate-x-1/2',
    'absolute -top-6 right-1/4 translate-x-1/2',
    'absolute top-1/2 -right-8 -translate-y-1/2',
    'absolute -bottom-6 right-1/4 translate-x-1/2',
    'absolute -bottom-6 left-1/4 -translate-x-1/2',
    'absolute top-1/2 -left-8 -translate-y-1/2',
  ]

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="relative w-full max-w-2xl aspect-[2/1]">
        {/* Mini felt table */}
        <div className="absolute inset-0 poker-table-gradient-spectator rounded-[120px] border border-outline-variant/10 shadow-xl flex items-center justify-center">
          {/* Community cards */}
          <div className="scale-75">
            <CommunityCards cards={cards} detailed />
          </div>

          {/* Pot */}
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-full">
            <div className="glass-panel px-4 py-1.5 rounded-full flex flex-col items-center border border-primary/20">
              <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-on-surface/50">
                Pot
              </span>
              <span className="text-lg font-black text-secondary font-headline">
                ${hand.winAmount.toLocaleString()}
              </span>
            </div>
          </div>
        </div>

        {/* Mini players */}
        {hand.participants.slice(0, 6).map((name, i) => (
          <div key={name} className={positions[i]}>
            <MiniPlayer name={name} isWinner={name === hand.winner} />
          </div>
        ))}
      </div>
    </div>
  )
}
