import type { SidePot } from '../../types/game'

interface PotDisplayProps {
  amount: number
  sidePots?: SidePot[]
  /** Glass panel style (spectator) vs text style (player) */
  variant?: 'text' | 'glass'
}

export function PotDisplay({ amount, sidePots, variant = 'text' }: PotDisplayProps) {
  const hasSidePots = sidePots && sidePots.length > 1

  if (variant === 'glass') {
    return (
      <div className="flex flex-col items-center gap-1">
        <div className="glass-panel px-6 py-2 rounded-full flex flex-col items-center border border-primary/20">
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-on-surface/50">
            Total Pot
          </span>
          <span className="text-2xl font-black text-secondary font-headline">
            ${amount.toLocaleString()}
          </span>
        </div>
        {hasSidePots && (
          <div className="flex gap-2 flex-wrap justify-center">
            {sidePots.map((pot, i) => (
              <div key={i} className="glass-panel px-3 py-1 rounded-full text-[10px] font-bold text-on-surface/70 border border-outline-variant/20">
                {i === 0 ? '主池' : `边池${i}`} ${pot.amount.toLocaleString()}
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center">
      <div className="flex items-center gap-1.5">
        <span className="material-symbols-outlined text-secondary text-lg" style={{ fontVariationSettings: "'FILL' 1" }}>paid</span>
        <span className="text-secondary font-headline text-2xl font-extrabold tracking-tight drop-shadow-md">
          底池: ${amount.toLocaleString()}
        </span>
      </div>
      {hasSidePots && (
        <div className="flex gap-2 mt-1 flex-wrap justify-center">
          {sidePots.map((pot, i) => (
            <span key={i} className="text-[10px] font-bold text-on-surface-variant bg-surface-container-high px-2 py-0.5 rounded-full">
              {i === 0 ? '主池' : `边池${i}`} ${pot.amount.toLocaleString()}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
