import type { HandHistory } from '../../types/history'
import type { Card } from '../../types/card'
import type { StructuredImpression } from '../../types/player'

interface HandDetailProps {
  hand: HandHistory
}

function cardToStr(card: Card): string {
  const suitMap: Record<string, string> = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' }
  const rankMap: Record<string, string> = { T: '10', J: 'J', Q: 'Q', K: 'K', A: 'A' }
  return `${rankMap[card.rank] || card.rank}${suitMap[card.suit]}`
}

const STREET_NAMES: Record<string, string> = {
  preflop: '翻前', flop: '翻牌', turn: '转牌', river: '河牌',
}

const ACTION_NAMES: Record<string, (amount: number) => string> = {
  postSmallBlind: (a) => `支付小盲注 $${a}`,
  postBigBlind: (a) => `支付大盲注 $${a}`,
  fold: () => '弃牌',
  check: () => '过牌',
  call: (a) => `跟注 $${a}`,
  bet: (a) => `下注 $${a}`,
  raise: (a) => `加注到 $${a}`,
  allIn: (a) => `全下 $${a}`,
}

const TYPE_ICON: Record<string, string> = {
  human: 'person', llm: 'smart_toy', bot: 'target',
}

const TYPE_COLOR: Record<string, string> = {
  human: 'text-tertiary', llm: 'text-on-tertiary-container', bot: 'text-secondary',
}

/**
 * HandDetail — shows a complete hand log with all streets, actions,
 * community cards, winners, LLM thoughts, and impressions.
 */
export function HandDetail({ hand }: HandDetailProps) {
  const streets = ['preflop', 'flop', 'turn', 'river'] as const

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-headline font-bold text-lg text-on-surface flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">style</span>
            第 {hand.handNumber} 手
          </h2>
          <p className="text-xs text-on-surface-variant mt-1">
            {new Date(hand.timestamp).toLocaleString('zh-CN')} · 盲注 ${hand.smallBlind}/${hand.bigBlind} · 底池 ${hand.pot}
          </p>
        </div>
      </div>

      {/* Players */}
      <div className="bg-surface-container rounded-xl p-4">
        <h3 className="text-xs font-bold uppercase tracking-widest text-on-surface-variant mb-3 flex items-center gap-2">
          <span className="material-symbols-outlined text-sm">group</span>
          参与玩家
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {hand.players.map(p => {
            const profit = p.chipsAfter - p.chips
            const profitText = profit >= 0 ? `+$${profit}` : `-$${Math.abs(profit)}`
            const profitColor = profit > 0 ? 'text-green-400' : profit < 0 ? 'text-red-400' : 'text-on-surface-variant'
            const cards = p.holeCards.length === 2 ? p.holeCards.map(cardToStr).join(' ') : '??'
            const isWinner = hand.winners.some(w => w.playerId === p.id)

            return (
              <div key={p.id} className={`flex items-center gap-2 p-2 rounded-lg ${isWinner ? 'bg-primary/10 border border-primary/20' : 'bg-surface-container-high/50'}`}>
                <span className={`material-symbols-outlined text-sm ${TYPE_COLOR[p.type] || 'text-on-surface-variant'}`}>
                  {TYPE_ICON[p.type] || 'person'}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    <span className="text-xs font-bold text-on-surface truncate">{p.name}</span>
                    {isWinner && <span className="text-[10px]">🏆</span>}
                  </div>
                  <div className="text-[10px] text-on-surface-variant">
                    {cards} · ${p.chips}→${p.chipsAfter} <span className={profitColor}>{profitText}</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Community cards */}
      {hand.communityCards.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">公共牌:</span>
          <div className="flex gap-1">
            {hand.communityCards.map((c, i) => {
              const color = (c.suit === 'hearts' || c.suit === 'diamonds') ? 'text-red-400' : 'text-on-surface'
              return (
                <span key={i} className={`text-sm font-bold ${color} bg-surface-container-high px-2 py-1 rounded`}>
                  {cardToStr(c)}
                </span>
              )
            })}
          </div>
        </div>
      )}

      {/* Action log by street */}
      <div className="space-y-3">
        {streets.map(street => {
          const streetData = hand.streets[street]
          if (streetData.actions.length === 0) return null

          return (
            <div key={street} className="bg-surface-container rounded-xl overflow-hidden">
              <div className="px-4 py-2 bg-surface-container-high/50 border-b border-outline-variant/10">
                <span className="text-xs font-bold uppercase tracking-widest text-primary">
                  {STREET_NAMES[street]}
                </span>
                {street !== 'preflop' && streetData.cards && streetData.cards.length > 0 && (
                  <span className="text-xs text-on-surface-variant ml-2">
                    [{streetData.cards.map(cardToStr).join(' ')}]
                  </span>
                )}
              </div>
              <div className="px-4 py-2 space-y-1">
                {streetData.actions.map((action, i) => {
                  const player = hand.players.find(p => p.id === action.playerId)
                  const actionFn = ACTION_NAMES[action.type]
                  const actionText = actionFn ? actionFn(action.amount) : action.type

                  return (
                    <div key={i} className="flex items-center gap-2 py-0.5">
                      <span className={`material-symbols-outlined text-xs ${TYPE_COLOR[player?.type || 'bot'] || 'text-on-surface-variant'}`}>
                        {TYPE_ICON[player?.type || 'bot'] || 'person'}
                      </span>
                      <span className="text-xs font-bold text-on-surface min-w-[60px]">{player?.name || action.playerId}</span>
                      <span className="text-xs text-on-surface-variant">{actionText}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {/* Winners */}
      {hand.winners.length > 0 && (
        <div className="bg-primary/10 border border-primary/20 rounded-xl p-4">
          <h3 className="text-xs font-bold uppercase tracking-widest text-primary mb-2 flex items-center gap-2">
            <span className="material-symbols-outlined text-sm">emoji_events</span>
            赢家
          </h3>
          <div className="space-y-1">
            {hand.winners.map((w, i) => {
              const player = hand.players.find(p => p.id === w.playerId)
              return (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-sm font-bold text-on-surface">{player?.name || w.playerId}</span>
                  <span className="text-xs text-primary font-bold">+${w.amount}</span>
                  <span className="text-[10px] text-on-surface-variant bg-surface-container px-1.5 py-0.5 rounded">
                    {w.handRank}
                  </span>
                  {w.winningCards.length > 0 && (
                    <span className="text-[10px] text-on-surface-variant">
                      [{w.winningCards.map(cardToStr).join(' ')}]
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* LLM Thoughts */}
      {Object.keys(hand.llmThoughts).length > 0 && (
        <div className="bg-surface-container rounded-xl p-4">
          <h3 className="text-xs font-bold uppercase tracking-widest text-on-surface-variant mb-3 flex items-center gap-2">
            <span className="material-symbols-outlined text-sm text-primary">psychology</span>
            LLM 思考链
          </h3>
          <div className="space-y-3">
            {Object.entries(hand.llmThoughts).map(([playerId, thinking]) => {
              const player = hand.players.find(p => p.id === playerId)
              return (
                <div key={playerId}>
                  <div className="text-xs font-bold text-on-surface mb-1 flex items-center gap-1">
                    <span className="material-symbols-outlined text-xs text-on-tertiary-container">smart_toy</span>
                    {player?.name || playerId}
                  </div>
                  <div className="text-[11px] text-on-surface-variant leading-relaxed bg-surface-container-high/50 p-3 rounded-lg whitespace-pre-wrap">
                    {thinking}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* LLM Impressions snapshot */}
      {Object.keys(hand.llmImpressions).length > 0 && (
        <div className="bg-surface-container rounded-xl p-4">
          <h3 className="text-xs font-bold uppercase tracking-widest text-on-surface-variant mb-3 flex items-center gap-2">
            <span className="material-symbols-outlined text-sm text-primary">psychology</span>
            印象快照
          </h3>
          <div className="space-y-3">
            {Object.entries(hand.llmImpressions).map(([playerId, impressions]) => {
              const player = hand.players.find(p => p.id === playerId)
              return (
                <div key={playerId}>
                  <div className="text-xs font-bold text-on-surface mb-1">{player?.name || playerId} 的印象:</div>
                  {Object.entries(impressions).map(([targetId, imp]) => {
                    const target = hand.players.find(p => p.id === targetId)
                    return (
                      <HistoryImpressionRow key={targetId} targetName={target?.name || targetId} imp={imp} />
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Side pots */}
      {hand.sidePots && hand.sidePots.length > 1 && (
        <div className="text-xs text-on-surface-variant">
          <span className="font-bold">边池: </span>
          {hand.sidePots.map((sp, i) => (
            <span key={i} className="mr-2">Pool {i + 1}: ${sp.amount}</span>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------- Structured impression row for history ----------

function HistoryImpressionRow({ targetName, imp }: { targetName: string; imp: StructuredImpression }) {
  return (
    <div className="ml-4 mb-1">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[11px] font-bold text-on-surface-variant">{targetName}:</span>
        <span className="inline-flex items-center px-1 py-0.5 rounded text-[9px] font-bold bg-blue-500/15 text-blue-300">L={imp.looseness.toFixed(1)}</span>
        <span className="inline-flex items-center px-1 py-0.5 rounded text-[9px] font-bold bg-red-500/15 text-red-300">A={imp.aggression.toFixed(1)}</span>
        <span className="inline-flex items-center px-1 py-0.5 rounded text-[9px] font-bold bg-amber-500/15 text-amber-300">S={imp.stickiness.toFixed(1)}</span>
        <span className="inline-flex items-center px-1 py-0.5 rounded text-[9px] font-bold bg-green-500/15 text-green-300">H={imp.honesty.toFixed(1)}</span>
        <span className="text-[9px] text-on-surface-variant/60">({imp.handCount}手)</span>
      </div>
      {imp.note && (
        <p className="text-[10px] text-on-surface-variant/80 ml-0 mt-0.5">"{imp.note}"</p>
      )}
    </div>
  )
}
