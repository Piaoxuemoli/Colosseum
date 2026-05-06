import { useState } from 'react'

interface RankingPlayer {
  id: string
  name: string
  type: 'human' | 'llm' | 'bot'
  chips: number
  initialChips: number
}

interface RankingPanelProps {
  players: RankingPlayer[]
  handCount: number
  onClose: () => void
  onBackToSetup: () => void
}

/**
 * RankingPanel — displayed when the game ends (manually or auto-detected).
 * Shows player standings sorted by chips with profit/loss indicators.
 */
export function RankingPanel({ players, handCount, onClose, onBackToSetup }: RankingPanelProps) {
  const sorted = [...players].sort((a, b) => b.chips - a.chips)
  const maxChips = Math.max(...sorted.map(p => p.chips), 1)

  const typeIcon: Record<string, string> = {
    human: 'person', llm: 'smart_toy', bot: 'target',
  }
  const typeColor: Record<string, string> = {
    human: 'text-tertiary', llm: 'text-on-tertiary-container', bot: 'text-secondary',
  }

  const medals = ['🥇', '🥈', '🥉']

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-surface-container-low border border-outline-variant/20 rounded-2xl shadow-2xl max-w-lg w-full mx-4 overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-primary/20 to-tertiary/20 px-6 py-5 text-center">
          <span className="material-symbols-outlined text-4xl text-primary mb-2 block">emoji_events</span>
          <h2 className="font-headline text-xl font-bold text-on-surface">对局结束</h2>
          <p className="text-sm text-on-surface-variant mt-1">
            共 {handCount} 手
          </p>
        </div>

        {/* Rankings */}
        <div className="px-6 py-4 space-y-2 max-h-[50vh] overflow-y-auto">
          {sorted.map((player, idx) => {
            const profit = player.chips - player.initialChips
            const profitText = profit >= 0 ? `+$${profit}` : `-$${Math.abs(profit)}`
            const profitColor = profit > 0 ? 'text-green-400' : profit < 0 ? 'text-red-400' : 'text-on-surface-variant'
            const barWidth = maxChips > 0 ? (player.chips / maxChips) * 100 : 0
            const isEliminated = player.chips === 0

            return (
              <div
                key={player.id}
                className={`relative rounded-xl overflow-hidden transition-all ${idx === 0 ? 'bg-primary/10 border border-primary/30' : 'bg-surface-container'} ${isEliminated ? 'opacity-50' : ''}`}
              >
                {/* Chip bar background */}
                <div
                  className={`absolute inset-y-0 left-0 ${idx === 0 ? 'bg-primary/10' : 'bg-surface-container-high/50'} transition-all duration-500`}
                  style={{ width: `${barWidth}%` }}
                />

                <div className="relative flex items-center gap-3 px-4 py-3">
                  {/* Rank */}
                  <div className="w-8 text-center flex-shrink-0">
                    {idx < 3 ? (
                      <span className="text-lg">{medals[idx]}</span>
                    ) : (
                      <span className="text-sm font-bold text-on-surface-variant">#{idx + 1}</span>
                    )}
                  </div>

                  {/* Player info */}
                  <span className={`material-symbols-outlined text-sm ${typeColor[player.type] || 'text-on-surface-variant'}`}>
                    {typeIcon[player.type] || 'person'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <span className={`text-sm font-bold ${idx === 0 ? 'text-primary' : 'text-on-surface'}`}>
                      {player.name}
                    </span>
                  </div>

                  {/* Chips & profit */}
                  <div className="text-right flex-shrink-0">
                    <div className={`text-sm font-bold ${isEliminated ? 'text-on-surface-variant' : 'text-on-surface'}`}>
                      ${player.chips.toLocaleString()}
                    </div>
                    <div className={`text-[10px] font-bold ${profitColor}`}>
                      {profitText}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Actions */}
        <div className="px-6 py-4 border-t border-outline-variant/10 flex items-center gap-3">
          <button
            onClick={onBackToSetup}
            className="flex-1 bg-primary text-on-primary font-bold py-2.5 rounded-lg hover:bg-primary-container transition-all active:scale-95 flex items-center justify-center gap-2"
          >
            <span className="material-symbols-outlined text-sm">settings</span>
            返回配置
          </button>
          <button
            onClick={onClose}
            className="flex-1 bg-surface-container-high text-on-surface font-bold py-2.5 rounded-lg hover:bg-surface-container-highest transition-all active:scale-95 flex items-center justify-center gap-2"
          >
            <span className="material-symbols-outlined text-sm">visibility</span>
            继续查看
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * EndGameButton — small button to manually end the current game.
 */
interface EndGameButtonProps {
  onEndGame: () => void
}

export function EndGameButton({ onEndGame }: EndGameButtonProps) {
  const [confirming, setConfirming] = useState(false)

  if (confirming) {
    return (
      <div className="flex items-center gap-1">
        <span className="text-[10px] text-on-surface-variant">确定结束？</span>
        <button
          onClick={() => { onEndGame(); setConfirming(false) }}
          className="text-[10px] bg-error text-on-error px-2 py-1 rounded font-bold hover:bg-error-container transition-all"
        >
          确定
        </button>
        <button
          onClick={() => setConfirming(false)}
          className="text-[10px] bg-surface-container-high text-on-surface-variant px-2 py-1 rounded font-bold hover:bg-surface-container-highest transition-all"
        >
          取消
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="flex items-center space-x-1 glass-panel px-3 py-1.5 rounded-full hover:bg-error/10 hover:border-error/30 transition-all group text-on-surface-variant hover:text-error"
      title="结束本场对局"
    >
      <span className="material-symbols-outlined text-sm group-hover:text-error transition-colors">stop_circle</span>
      <span className="text-[10px] font-label uppercase tracking-wider font-semibold">结束对局</span>
    </button>
  )
}
