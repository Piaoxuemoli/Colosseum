import type { CardData } from '../../types/ui'
import { PlayingCard, PlayingCardSimple, EmptyCardSlot } from './PlayingCard'

interface CommunityCardsProps {
  cards: CardData[]
  /** Use detailed card style (spectator) vs simple (player) */
  detailed?: boolean
}

const slotLabels = ['', '', '', 'TURN', 'RIVER']

export function CommunityCards({ cards, detailed }: CommunityCardsProps) {
  return (
    <div className="bg-black/10 rounded-xl px-4 py-3">
      <div className="flex space-x-3 items-center">
      {cards.map((card, i) => {
        if (!card) {
          return <EmptyCardSlot key={i} label={slotLabels[i]} />
        }
        if (detailed) {
          return <PlayingCard key={i} card={card} />
        }
        return <PlayingCardSimple key={i} card={card} />
      })}
      </div>
    </div>
  )
}
