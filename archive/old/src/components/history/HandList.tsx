import type { HandHistoryEntry } from '../../types/ui'

interface HandListProps {
  hands: HandHistoryEntry[]
  selectedHandId: string | undefined
  onSelect: (id: string) => void
}

export function HandList({ hands, selectedHandId, onSelect }: HandListProps) {
  return (
    <div className="flex-1 flex flex-col h-full min-w-0">
      {/* Header */}
      <div className="p-4 border-b border-outline-variant/10 flex-shrink-0">
        <h3 className="font-headline font-bold text-sm tracking-tight flex items-center space-x-2 mb-3">
          <span className="material-symbols-outlined text-primary text-sm">history</span>
          <span>手牌历史</span>
        </h3>
        {/* Search */}
        <div className="relative">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-sm">
            search
          </span>
          <input
            type="text"
            placeholder="搜索手牌..."
            className="w-full bg-surface-container-high border-none rounded-lg text-sm text-on-surface pl-10 pr-3 py-2 focus:ring-1 focus:ring-primary placeholder:text-on-surface-variant/50"
          />
        </div>
      </div>

      {/* Hand list */}
      <div className="flex-1 overflow-y-auto min-w-0">
        {hands.map((hand) => {
          const isSelected = hand.id === selectedHandId
          return (
            <button
              key={hand.id}
              onClick={() => onSelect(hand.id)}
              className={`w-full text-left px-4 py-3 transition-colors border-l-2 ${
                isSelected
                  ? 'bg-surface-container-high border-primary'
                  : 'border-transparent hover:bg-surface-container/50'
              }`}
            >
              <div className="flex justify-between items-start mb-1 gap-2">
                <span className={`text-xs font-bold font-headline flex-shrink-0 ${isSelected ? 'text-primary' : 'text-on-surface'}`}>
                  Hand #{hand.handNumber}
                </span>
                <span className="text-[10px] text-on-surface-variant flex-shrink-0">{hand.date}</span>
              </div>
              <div className="flex items-center gap-1 flex-wrap mb-1.5">
                {hand.participants.slice(0, 3).map((name) => (
                  <span
                    key={name}
                    className="text-[9px] bg-surface-container-highest/60 text-on-surface-variant px-1.5 py-0.5 rounded truncate max-w-[60px]"
                  >
                    {name}
                  </span>
                ))}
                {hand.participants.length > 3 && (
                  <span className="text-[9px] text-on-surface-variant">
                    +{hand.participants.length - 3}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <span className="material-symbols-outlined text-secondary text-xs">emoji_events</span>
                <span className="text-[10px] text-secondary font-bold truncate">{hand.winner}</span>
                <span className="text-[10px] text-on-surface-variant flex-shrink-0">
                  +${hand.winAmount.toLocaleString()}
                </span>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
