interface LiveRankingProps {
  players: { id: string; name: string; type: string; chips: number }[]
  prevRanks: Record<string, number>
  firstPlaceStreak: number
  firstPlacePlayerId: string | null
  handNumber?: number
}

function textColorForType(type: string): string {
  switch (type) {
    case 'llm': return 'text-tertiary'
    case 'human': return 'text-primary'
    case 'bot': return 'text-secondary'
    default: return 'text-on-surface-variant'
  }
}

function rankBadge(rank: number): string {
  switch (rank) {
    case 1: return '🥇'
    case 2: return '🥈'
    case 3: return '🥉'
    default: return `#${rank}`
  }
}

export function LiveRanking({ players, prevRanks, firstPlaceStreak, firstPlacePlayerId, handNumber }: LiveRankingProps) {
  const sorted = [...players]
    .filter(p => p.chips > 0 || prevRanks[p.id])
    .sort((a, b) => b.chips - a.chips)

  return (
    <div className="border-t border-outline-variant/10 px-3 py-2.5 bg-surface-container-lowest">
      <div className="flex justify-between items-center mb-2">
        <span className="text-[8px] font-bold uppercase tracking-widest text-on-surface/25">Leaderboard</span>
        {handNumber && <span className="text-[8px] text-on-surface/25">第 {handNumber} 手</span>}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {sorted.map((player, i) => {
          const currentRank = i + 1
          const isFirst = currentRank === 1
          const showStreak = isFirst && firstPlaceStreak >= 2 && player.id === firstPlacePlayerId

          return (
            <div
              key={player.id}
              className={`flex items-center gap-1 px-2 py-1 rounded-full text-[8px]
                ${isFirst ? 'bg-primary/8' : ''}`}
            >
              <span className="font-bold">{rankBadge(currentRank)}</span>
              <span className={`font-extrabold truncate max-w-[60px] ${textColorForType(player.type)}`}>
                {player.name}
              </span>
              <span className="font-black text-on-surface">${player.chips.toLocaleString()}</span>
              {showStreak && <span className="text-orange-400 font-bold">🔥{firstPlaceStreak}</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
