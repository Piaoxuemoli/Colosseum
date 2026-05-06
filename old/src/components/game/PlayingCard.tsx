import type { CardData } from '../../types/ui'

/** Map suit to Material icon name and color */
function suitInfo(suit: string): { icon: string; color: string } {
  switch (suit) {
    case 'heart':
      return { icon: 'favorite', color: 'text-red-600' }
    case 'diamond':
      return { icon: 'diamond', color: 'text-red-500' }
    case 'club':
      return { icon: 'eco', color: 'text-surface' }
    case 'spade':
    default:
      return { icon: 'spa', color: 'text-surface' }
  }
}

interface PlayingCardProps {
  card: CardData
  /** Mini size for seat-side cards */
  mini?: boolean
  /** Show glowing hero border */
  glow?: boolean
}

export function PlayingCard({ card, mini, glow }: PlayingCardProps) {
  // Empty slot
  if (!card) {
    if (mini) return null
    return (
      <div className="w-[72px] h-[104px] border-2 border-dashed border-on-surface/20 rounded-lg flex items-center justify-center">
        <div className="w-full h-full bg-surface-container-low/20 rounded-lg" />
      </div>
    )
  }

  const { icon, color } = suitInfo(card.suit)

  // Mini card (used next to seats — enlarged)
  if (mini) {
    return (
      <div
        className={`w-12 h-[68px] bg-on-surface rounded-md shadow-md border p-1.5 flex flex-col ${
          glow ? 'border-primary animate-pulse shadow-primary/30' : 'border-outline-variant'
        }`}
      >
        <div className={`text-xs font-bold leading-tight ${color === 'text-surface' ? 'text-surface' : color}`}>
          {card.rank}
        </div>
        <span
          className={`material-symbols-outlined text-base self-center mt-auto ${color === 'text-surface' ? 'text-surface' : color}`}
          style={{ fontVariationSettings: "'FILL' 1" }}
        >
          {icon}
        </span>
      </div>
    )
  }

  // Full community card (detailed version — enlarged)
  return (
    <div className="w-[72px] h-[104px] bg-on-surface rounded-lg shadow-lg flex flex-col items-center justify-between p-2.5 group hover:-translate-y-1 transition-transform">
      <div className="w-full flex justify-between items-center">
        <span className={`font-bold text-xl leading-none ${color}`}>{card.rank}</span>
        <span
          className={`material-symbols-outlined text-base ${color}`}
          style={{ fontVariationSettings: "'FILL' 1" }}
        >
          {icon}
        </span>
      </div>
      <span
        className={`material-symbols-outlined text-4xl ${color}`}
        style={{ fontVariationSettings: "'FILL' 1" }}
      >
        {icon}
      </span>
      <div className="w-full flex justify-between items-center rotate-180">
        <span className={`font-bold text-xl leading-none ${color}`}>{card.rank}</span>
        <span
          className={`material-symbols-outlined text-base ${color}`}
          style={{ fontVariationSettings: "'FILL' 1" }}
        >
          {icon}
        </span>
      </div>
    </div>
  )
}

/** Simple card for Player View (less detailed — enlarged) */
export function PlayingCardSimple({ card }: { card: CardData }) {
  if (!card) {
    return (
      <div className="w-[72px] h-[104px] border-2 border-dashed border-on-surface/20 rounded-lg flex items-center justify-center">
        <span className="text-on-surface/20 text-xs font-label" />
      </div>
    )
  }

  const { icon } = suitInfo(card.suit)
  const isRed = card.suit === 'heart' || card.suit === 'diamond'

  return (
    <div className="w-[72px] h-[104px] bg-on-surface rounded-lg flex flex-col p-2.5 shadow-lg relative overflow-hidden group hover:-translate-y-1 transition-transform">
      <span className={`${isRed ? 'text-red-600' : 'text-background'} font-bold text-xl`}>
        {card.rank}
      </span>
      <span
        className={`material-symbols-outlined ${isRed ? 'text-red-600' : 'text-background'} self-center mt-auto text-3xl`}
        style={{ fontVariationSettings: "'FILL' 1" }}
      >
        {icon}
      </span>
    </div>
  )
}

/** Empty slot with label (TURN / RIVER — enlarged) */
export function EmptyCardSlot({ label }: { label?: string }) {
  return (
    <div className="w-[72px] h-[104px] border-2 border-dashed border-on-surface/20 rounded-lg flex items-center justify-center">
      {label ? (
        <span className="text-on-surface/20 text-xs font-label">{label}</span>
      ) : (
        <div className="w-full h-full bg-surface-container-low/20 rounded-lg" />
      )}
    </div>
  )
}
