/**
 * 斗地主 UI 组件集合
 * 精致的中式牌桌视觉风格
 */

import { useState, useMemo } from 'react'
import type { DdzCard, DdzGameState, DdzPlayer, DdzAction, CardCombo, DdzRank, DdzSuit } from '../engine/ddz-types'
import { ddzRankValue } from '../engine/ddz-types'
import { useAppStore } from '../../../store/app-store'

// ═══════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════

function suitInfo(suit: DdzSuit): { char: string; color: string } {
  switch (suit) {
    case 'hearts': return { char: '♥', color: 'text-red-600' }
    case 'diamonds': return { char: '♦', color: 'text-red-500' }
    case 'clubs': return { char: '♣', color: 'text-neutral-800' }
    case 'spades': return { char: '♠', color: 'text-neutral-900' }
    case 'joker': return { char: '★', color: 'text-amber-600' }
    default: return { char: '?', color: 'text-neutral-500' }
  }
}

function isRedSuit(suit: DdzSuit): boolean {
  return suit === 'hearts' || suit === 'diamonds'
}

function rankDisplayShort(rank: DdzRank): string {
  if (rank === 'JOKER_S') return '小'
  if (rank === 'JOKER_B') return '大'
  return rank
}

function sortCards(cards: DdzCard[]): DdzCard[] {
  return [...cards].sort((a, b) => ddzRankValue(a.rank) - ddzRankValue(b.rank))
}

function comboName(type: string): string {
  const map: Record<string, string> = {
    single: '单张', pair: '对子', triple: '三条',
    triple_one: '三带一', triple_pair: '三带对',
    straight: '顺子', bomb: '炸弹 💣', rocket: '火箭 🚀', pass: '不出',
  }
  return map[type] || type
}

function roleLabel(role: string): string {
  return role === 'landlord' ? '👑 地主' : '🌾 农民'
}

function roleIcon(role: string): string {
  return role === 'landlord' ? '👑' : '🌾'
}

// ═══════════════════════════════════════════
// 单张卡牌 — 经典扑克牌风格
// ═══════════════════════════════════════════

function DdzCardView({ card, selected, onClick, small }: {
  card: DdzCard
  selected?: boolean
  onClick?: () => void
  small?: boolean
}) {
  const { char, color } = suitInfo(card.suit)
  const isJoker = card.suit === 'joker'
  const isRedJoker = card.rank === 'JOKER_B'
  const red = isRedSuit(card.suit) || isRedJoker
  const textColor = isJoker
    ? (isRedJoker ? 'text-red-600' : 'text-blue-700')
    : color

  const w = small ? 'w-9 h-[52px]' : 'w-[52px] h-[76px]'
  const fontSize = small ? 'text-[11px]' : 'text-sm'
  const suitSize = small ? 'text-[10px]' : 'text-xs'

  return (
    <div
      onClick={onClick}
      className={`${w} rounded-md shadow-sm border flex flex-col justify-between shrink-0 transition-all duration-150 select-none overflow-hidden
        ${selected
          ? '-translate-y-4 ring-2 ring-primary shadow-lg shadow-primary/30 border-primary bg-gradient-to-b from-white to-primary/5'
          : 'border-neutral-200/80 bg-gradient-to-b from-white to-neutral-50'}
        ${onClick ? 'cursor-pointer hover:-translate-y-1.5 hover:shadow-md active:scale-[0.97]' : ''}
      `}
    >
      {/* 左上角: 点数 + 花色 */}
      <div className={`px-1 pt-0.5 leading-none ${textColor}`}>
        <div className={`${fontSize} font-black`}>{rankDisplayShort(card.rank)}</div>
        {!isJoker && <div className={`${suitSize} -mt-0.5`}>{char}</div>}
      </div>
      {/* 中心花色 / Joker 标识 */}
      <div className={`self-center ${isJoker ? '' : 'pb-1'}`}>
        {isJoker ? (
          <span className={`${small ? 'text-lg' : 'text-2xl'} ${isRedJoker ? '' : ''}`}>
            {isRedJoker ? '🃏' : '🃏'}
          </span>
        ) : (
          <span className={`${small ? 'text-base' : 'text-xl'} ${red ? 'text-red-500' : 'text-neutral-700'}`}>{char}</span>
        )}
      </div>
    </div>
  )
}

/** 牌背 — 精致的花纹背面 */
function DdzCardBack({ count }: { count: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex -space-x-5">
        {Array.from({ length: Math.min(count, 3) }).map((_, i) => (
          <div
            key={i}
            className="w-9 h-[52px] rounded-md border border-blue-900/30 bg-gradient-to-br from-blue-900 to-blue-800 shadow-sm"
            style={{ transform: `rotate(${(i - 1) * 5}deg)` }}
          >
            <div className="w-full h-full rounded-md border border-blue-400/10 flex items-center justify-center">
              <span className="text-blue-300/30 text-[8px] font-black">DDZ</span>
            </div>
          </div>
        ))}
      </div>
      <span className="text-[11px] font-bold text-on-surface-variant tabular-nums">{count}张</span>
    </div>
  )
}

// ═══════════════════════════════════════════
// 出牌区展示
// ═══════════════════════════════════════════

function PlayedCombo({ combo, label }: { combo: CardCombo | null; label?: string }) {
  if (!combo) return null
  if (combo.type === 'pass') {
    return (
      <div className="px-5 py-1.5 rounded-full bg-on-surface/5 text-on-surface-variant/60 text-xs font-bold border border-outline-variant/10">
        不出
      </div>
    )
  }
  return (
    <div className="flex flex-col items-center gap-1.5">
      {label && <span className="text-[9px] text-on-surface-variant/50 font-bold uppercase tracking-wider">{label}</span>}
      <div className="flex -space-x-3">
        {combo.cards.map((c, i) => (
          <DdzCardView key={`${c.rank}-${c.suit}-${i}`} card={c} small />
        ))}
      </div>
      <span className="text-[10px] font-bold text-primary/80">{comboName(combo.type)}</span>
    </div>
  )
}

// ═══════════════════════════════════════════
// 思维气泡 — 毛玻璃浮动
// ═══════════════════════════════════════════

function ThinkingBubble({ content, isThinking }: { content?: string; isThinking: boolean }) {
  if (!isThinking && !content) return null
  return (
    <div className="absolute -top-3 left-1/2 -translate-x-1/2 -translate-y-full z-20 w-60 animate-fade-in">
      <div className="bg-surface-container/90 backdrop-blur-xl border border-primary/15 rounded-2xl px-4 py-3 shadow-xl shadow-black/20 relative">
        {content ? (
          <p className="text-[11px] text-on-surface/90 leading-relaxed line-clamp-4 whitespace-pre-wrap">{content}</p>
        ) : (
          <div className="flex items-center gap-2.5">
            <div className="flex gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
            <span className="text-[11px] font-bold text-primary/70">思考中</span>
          </div>
        )}
        {/* 三角箭头 */}
        <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-surface-container/90 border-r border-b border-primary/15 rotate-45" />
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════
// DdzBoard Props
// ═══════════════════════════════════════════

interface DdzBoardProps {
  gameState: DdzGameState | null
  onAction?: (action: DdzAction) => void
  thinkingBotId?: string | null
  llmThoughts?: Record<string, string>
  /** 视角切换: 纯AI模式下选择从哪个玩家视角观看 */
  viewAsPlayerIndex?: number
  /** 最近的 bot 动作 — 短暂显示在座位上 */
  lastBotAction?: { playerId: string; action: string } | null
}

// ═══════════════════════════════════════════
// DdzBoard
// ═══════════════════════════════════════════

export function DdzBoard({ gameState, onAction, thinkingBotId, llmThoughts, viewAsPlayerIndex = 0, lastBotAction }: DdzBoardProps) {
  if (!gameState) return <DdzBoardEmpty />
  if (gameState.phase === 'bidding') {
    return <DdzBoardBidding state={gameState} onAction={onAction} thinkingBotId={thinkingBotId} llmThoughts={llmThoughts} viewAsPlayerIndex={viewAsPlayerIndex} lastBotAction={lastBotAction} />
  }
  return <DdzBoardPlaying state={gameState} onAction={onAction} thinkingBotId={thinkingBotId} llmThoughts={llmThoughts} viewAsPlayerIndex={viewAsPlayerIndex} lastBotAction={lastBotAction} />
}

/** 空状态 */
function DdzBoardEmpty() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center space-y-8">
        {/* 装饰桌面 */}
        <div className="relative mx-auto w-[420px] h-[240px]">
          <div className="absolute inset-0 rounded-[100px] bg-gradient-to-b from-emerald-950/40 to-emerald-900/20 border border-emerald-700/15 shadow-inner shadow-emerald-950/50" />
          <div className="absolute inset-4 rounded-[80px] border border-dashed border-emerald-600/10" />
          {/* 三座位 */}
          {[
            { top: '-8px', left: '50%', tx: '-50%', label: '座位 1' },
            { bottom: '8px', left: '60px', tx: '0', label: '座位 2' },
            { bottom: '8px', right: '60px', tx: '0', label: '座位 3' },
          ].map((pos, i) => (
            <div key={i} className="absolute flex flex-col items-center gap-1" style={{ top: pos.top, bottom: pos.bottom, left: pos.left, right: pos.right, transform: `translateX(${pos.tx})` } as React.CSSProperties}>
              <div className="w-11 h-11 rounded-full bg-surface-container-high/50 border-2 border-dashed border-outline-variant/30 flex items-center justify-center">
                <span className="material-symbols-outlined text-on-surface-variant/30 text-lg">person</span>
              </div>
              <span className="text-[9px] text-on-surface-variant/30">{pos.label}</span>
            </div>
          ))}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-[0.06]">
            <span className="material-symbols-outlined text-6xl text-on-surface">playing_cards</span>
          </div>
        </div>
        <div>
          <h2 className="text-2xl font-black font-headline text-on-surface tracking-tight">斗 地 主</h2>
          <p className="text-on-surface-variant/60 text-sm mt-2 font-headline">三人对战 · 地主 vs 农民</p>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════
// DdzBoardBidding — 叫地主阶段
// ═══════════════════════════════════════════

function DdzBoardBidding({ state, onAction, thinkingBotId, llmThoughts, viewAsPlayerIndex = 0, lastBotAction }: {
  state: DdzGameState
  onAction?: (action: DdzAction) => void
  thinkingBotId?: string | null
  llmThoughts?: Record<string, string>
  viewAsPlayerIndex?: number
  lastBotAction?: { playerId: string; action: string } | null
}) {
  const isGodMode = useAppStore(s => s.gameMode) === 'spectator'

  const heroIndex = state.players.findIndex(p => p.type === 'human')
  const effectiveHeroIndex = heroIndex >= 0 ? heroIndex : viewAsPlayerIndex
  const hero = state.players[effectiveHeroIndex]
  const sortedHand = useMemo(() => sortCards(hero.hand), [hero.hand])

  const opponents = state.players.filter((_, i) => i !== effectiveHeroIndex)
  const isMyTurn = heroIndex >= 0 && state.currentPlayerIndex === heroIndex
  const currentPlayer = state.players[state.currentPlayerIndex]

  const handleBid = (score: number) => {
    if (!onAction) return
    onAction({ type: 'bid', playerId: hero.id, bidScore: score })
  }

  return (
    <div className="flex-1 flex flex-col relative overflow-hidden">
      {/* 绿色毡布桌面 */}
      <div className="absolute inset-0 bg-gradient-to-b from-[#0a1a12] via-[#0d2818] to-[#0a1a12]" />
      <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'20\' height=\'20\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Ccircle cx=\'1\' cy=\'1\' r=\'0.5\' fill=\'%23fff\'/%3E%3C/svg%3E")' }} />

      <div className="relative flex flex-col flex-1 z-10">

        {/* 顶部信息栏 */}
        <div className="flex items-center justify-between px-6 py-2.5 bg-black/20 backdrop-blur-sm border-b border-white/5">
          <div className="flex items-center gap-3">
            <span className="text-[11px] font-bold text-amber-300/80 bg-amber-400/10 px-3 py-1 rounded-full border border-amber-400/10">
              📢 叫地主阶段
            </span>
            {state.highestBid > 0 && (
              <span className="text-[11px] font-bold text-primary bg-primary/15 px-3 py-1 rounded-full">
                当前最高: {state.highestBid}分
              </span>
            )}
            {isGodMode && (
              <span className="text-[10px] font-bold text-secondary bg-secondary/15 px-2 py-0.5 rounded-full">👁 上帝模式</span>
            )}
            {currentPlayer && (
              <span className="text-[11px] font-bold text-primary bg-primary/15 px-3 py-1 rounded-full flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                轮到 {currentPlayer.name}
              </span>
            )}
          </div>
          {/* 底牌 (背面) */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-white/30 font-bold">底牌 (待翻)</span>
            <div className="flex gap-0.5">
              {[0, 1, 2].map(i => (
                <div key={i} className="w-9 h-[52px] rounded-md border border-blue-900/30 bg-gradient-to-br from-blue-900 to-blue-800 shadow-sm">
                  <div className="w-full h-full rounded-md border border-blue-400/10 flex items-center justify-center">
                    <span className="text-blue-300/30 text-[8px] font-black">?</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 对手区域 */}
        <div className="flex justify-around items-start px-12 pt-6 pb-2">
          {opponents.map((opp) => {
            const oppIdx = state.players.indexOf(opp)
            const bid = state.bidHistory.find(b => b.playerIndex === oppIdx)
            return (
              <div key={opp.id} className={`flex flex-col items-center gap-2 px-5 py-3 rounded-2xl transition-all relative ${
                state.currentPlayerIndex === oppIdx ? 'bg-white/[0.04] ring-1 ring-primary/30' : ''
              }`}>
                <ThinkingBubble content={llmThoughts?.[opp.id]} isThinking={thinkingBotId === opp.id} />

                <div className={`w-12 h-12 rounded-full flex items-center justify-center border-2 transition-all ${
                  state.currentPlayerIndex === oppIdx
                    ? 'bg-primary/15 border-primary shadow-md shadow-primary/20'
                    : 'bg-surface-container-high/30 border-white/10'
                }`}>
                  {thinkingBotId === opp.id ? (
                    <div className="flex gap-0.5">
                      <span className="w-1 h-1 rounded-full bg-primary animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-1 h-1 rounded-full bg-primary animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-1 h-1 rounded-full bg-primary animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  ) : (
                    <span className="text-lg">🤔</span>
                  )}
                </div>

                <span className={`text-xs font-bold ${state.currentPlayerIndex === oppIdx ? 'text-primary' : 'text-white/70'}`}>
                  {opp.name}
                </span>

                {/* 叫分结果 */}
                {bid !== undefined && (
                  <span className={`text-xs font-bold px-3 py-1 rounded-full ${
                    bid.score > 0
                      ? 'text-amber-300 bg-amber-400/15 border border-amber-400/20'
                      : 'text-white/40 bg-white/5 border border-white/10'
                  }`}>
                    {bid.score === 0 ? '不叫' : `${bid.score}分`}
                  </span>
                )}

                {/* 手牌 (上帝模式显示) */}
                {isGodMode ? (
                  <div className="flex flex-wrap gap-0.5 justify-center max-w-[260px]">
                    {sortCards(opp.hand).map((c, i) => (
                      <DdzCardView key={`${c.rank}-${c.suit}-${i}`} card={c} small />
                    ))}
                  </div>
                ) : (
                  <DdzCardBack count={opp.hand.length} />
                )}
              </div>
            )
          })}
        </div>

        {/* 中间 — 叫分进度 */}
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-4">
            <div className="text-4xl">📢</div>
            <h3 className="text-xl font-black font-headline text-white/90">叫地主</h3>
            {state.bidHistory.length > 0 ? (
              <div className="flex gap-4 justify-center">
                {state.bidHistory.map((b, i) => {
                  const p = state.players[b.playerIndex]
                  return (
                    <div key={i} className="flex flex-col items-center gap-1.5 bg-white/5 rounded-xl px-4 py-3 border border-white/5">
                      <span className="text-xs text-white/60 font-bold">{p.name}</span>
                      <span className={`text-sm font-black ${b.score > 0 ? 'text-amber-300' : 'text-white/30'}`}>
                        {b.score === 0 ? '不叫' : `${b.score}分`}
                      </span>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="text-white/30 text-sm">等待玩家叫分...</p>
            )}
          </div>
        </div>

        {/* 我的手牌 + 叫分按钮 */}
        <div className="px-6 pb-5 pt-3 bg-gradient-to-t from-black/30 to-transparent">
          <div className="flex items-center gap-2.5 mb-3">
            <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm border-2 ${
              isMyTurn ? 'bg-primary/20 border-primary ring-2 ring-primary/20 animate-pulse' : 'bg-surface-container-high/30 border-white/10'
            }`}>
              🤔
            </div>
            <span className="text-sm font-bold text-white/90">{hero.name}</span>
            {isMyTurn && (
              <span className="text-xs text-primary font-bold animate-pulse ml-2 bg-primary/10 px-3 py-1 rounded-full">
                👆 轮到你叫分
              </span>
            )}
            {thinkingBotId === hero.id && (
              <span className="text-xs text-primary/70 font-bold animate-pulse ml-2">思考中...</span>
            )}
            {lastBotAction?.playerId === hero.id && (
              <span className="text-xs font-bold text-primary bg-primary/15 px-3 py-1 rounded-full border border-primary/20 ml-2 animate-fade-in">
                {lastBotAction.action}
              </span>
            )}
            <span className="text-[10px] text-white/25 ml-auto tabular-nums">{hero.hand.length} 张</span>
          </div>

          {/* 手牌 (叫地主阶段只看不选) */}
          <div className="flex flex-wrap gap-1 justify-center pb-2 min-h-[80px]">
            {sortedHand.map((card, i) => (
              <DdzCardView key={`${card.rank}-${card.suit}-${i}`} card={card} />
            ))}
          </div>

          {/* 叫分按钮 — 动作掩码: 低于最高分的不可点 */}
          {isMyTurn && (
            <div className="flex justify-center gap-3 mt-1">
              <button
                onClick={() => handleBid(0)}
                className="px-7 py-2.5 bg-white/5 text-white/60 border border-white/10 rounded-xl font-bold text-sm hover:bg-white/10 transition-all active:scale-95"
              >
                不叫
              </button>
              {[1, 2, 3].map(score => {
                const disabled = score <= state.highestBid
                return (
                  <button
                    key={score}
                    onClick={() => handleBid(score)}
                    disabled={disabled}
                    className={`px-7 py-2.5 rounded-xl font-bold text-sm transition-all active:scale-95 ${
                      disabled
                        ? 'bg-white/3 text-white/15 border border-white/5 cursor-not-allowed'
                        : score === 3
                          ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-white shadow-lg shadow-amber-500/25 hover:brightness-110'
                          : 'bg-gradient-to-r from-primary to-emerald-500 text-white shadow-lg shadow-primary/25 hover:brightness-110'
                    }`}
                  >
                    {score}分
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** 对局进行中 */
function DdzBoardPlaying({ state, onAction, thinkingBotId, llmThoughts, viewAsPlayerIndex = 0, lastBotAction }: {
  state: DdzGameState
  onAction?: (action: DdzAction) => void
  thinkingBotId?: string | null
  llmThoughts?: Record<string, string>
  viewAsPlayerIndex?: number
  lastBotAction?: { playerId: string; action: string } | null
}) {
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set())
  const isGodMode = useAppStore(s => s.gameMode) === 'spectator'

  // Hero: 如果有 human 就用 human，否则用 viewAsPlayerIndex
  const heroIndex = state.players.findIndex(p => p.type === 'human')
  const effectiveHeroIndex = heroIndex >= 0 ? heroIndex : viewAsPlayerIndex
  const hero = state.players[effectiveHeroIndex]
  const sortedHand = useMemo(() => sortCards(hero.hand), [hero.hand])

  const currentPlayer = state.players[state.currentPlayerIndex]

  const toggleCard = (idx: number) => {
    setSelectedIndices(prev => {
      const next = new Set(prev)
      next.has(idx) ? next.delete(idx) : next.add(idx)
      return next
    })
  }

  const opponents = state.players.filter((_, i) => i !== effectiveHeroIndex)
  const isMyTurn = heroIndex >= 0 && state.currentPlayerIndex === heroIndex
  const canPass = state.lastPlay !== null && state.lastPlayPlayerIndex !== state.currentPlayerIndex

  const handlePlay = () => {
    if (!onAction || selectedIndices.size === 0) return
    onAction({ type: 'play', playerId: hero.id, cards: Array.from(selectedIndices).map(i => sortedHand[i]) })
    setSelectedIndices(new Set())
  }

  const handlePass = () => {
    if (!onAction) return
    onAction({ type: 'pass', playerId: hero.id })
    setSelectedIndices(new Set())
  }

  return (
    <div className="flex-1 flex flex-col relative overflow-hidden">
      {/* ═══ 绿色毡布桌面背景 ═══ */}
      <div className="absolute inset-0 bg-gradient-to-b from-[#0a1a12] via-[#0d2818] to-[#0a1a12]" />
      <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'20\' height=\'20\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Ccircle cx=\'1\' cy=\'1\' r=\'0.5\' fill=\'%23fff\'/%3E%3C/svg%3E")' }} />

      {/* ═══ 内容层 ═══ */}
      <div className="relative flex flex-col flex-1 z-10">

        {/* 顶部信息栏 — 毛玻璃 */}
        <div className="flex items-center justify-between px-6 py-2.5 bg-black/20 backdrop-blur-sm border-b border-white/5">
          <div className="flex items-center gap-3">
            <span className="text-[11px] font-bold text-emerald-300/80 bg-emerald-400/10 px-3 py-1 rounded-full border border-emerald-400/10">
              第 {state.roundNumber} 局
            </span>
            {state.multiplier > 1 && (
              <span className="text-[11px] font-bold text-amber-300 bg-amber-400/10 px-3 py-1 rounded-full border border-amber-400/10">
                🔥 {state.multiplier}倍
              </span>
            )}
            <span className="text-[11px] text-white/40">底分 {state.baseScore}</span>
            {isGodMode && (
              <span className="text-[10px] font-bold text-secondary bg-secondary/15 px-2 py-0.5 rounded-full">👁 上帝模式</span>
            )}
            {state.phase === 'playing' && currentPlayer && (
              <span className="text-[11px] font-bold text-primary bg-primary/15 px-3 py-1 rounded-full flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                {currentPlayer.name} 出牌
              </span>
            )}
          </div>
          {/* 底牌 */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-white/30 font-bold">底牌</span>
            <div className="flex gap-0.5">
              {state.kittyCards.map((c, i) => (
                <DdzCardView key={i} card={c} small />
              ))}
            </div>
          </div>
        </div>

        {/* ═══ 对手区域 ═══ */}
        <div className="flex justify-around items-start px-12 pt-6 pb-2">
          {opponents.map((opp) => {
            const oppIdx = state.players.indexOf(opp)
            return (
              <OpponentSeat
                key={opp.id}
                player={opp}
                isCurrentTurn={state.currentPlayerIndex === oppIdx}
                lastPlay={state.lastPlayPlayerIndex === oppIdx ? state.lastPlay : null}
                showCards={isGodMode}
                isThinking={thinkingBotId === opp.id}
                thinkingContent={llmThoughts?.[opp.id]}
                actionLabel={lastBotAction?.playerId === opp.id ? lastBotAction.action : undefined}
              />
            )
          })}
        </div>

        {/* ═══ 中心出牌区 ═══ */}
        <div className="flex-1 flex items-center justify-center min-h-[100px]">
          {state.phase === 'playing' && state.lastPlay && (
            <div className="animate-fade-in">
              <PlayedCombo combo={state.lastPlay} />
            </div>
          )}
          {state.phase === 'finished' && (
            <div className="text-center animate-fade-in">
              <div className="text-4xl mb-3">
                {state.players.find(p => p.hand.length === 0)?.role === 'landlord' ? '👑' : '🌾'}
              </div>
              <div className="text-2xl font-black font-headline text-white/90 mb-1">
                {state.players.find(p => p.hand.length === 0)?.role === 'landlord' ? '地主胜!' : '农民胜!'}
              </div>
              <div className="text-xs text-white/40">
                {state.players.find(p => p.hand.length === 0)?.name} · {state.multiplier}x · {state.baseScore}分
              </div>
            </div>
          )}
        </div>

        {/* ═══ 我的手牌区域 ═══ */}
        <div className="px-6 pb-5 pt-3 bg-gradient-to-t from-black/30 to-transparent">
          {/* 身份条 */}
          <div className="flex items-center gap-2.5 mb-3">
            <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm border-2 transition-all ${
              isMyTurn
                ? 'bg-primary/20 border-primary ring-2 ring-primary/20 animate-pulse'
                : 'bg-surface-container-high/30 border-white/10'
            }`}>
              {roleIcon(hero.role)}
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-bold text-white/90">{hero.name}</span>
              <span className={`text-[10px] font-bold ${hero.role === 'landlord' ? 'text-amber-400' : 'text-emerald-400'}`}>
                {roleLabel(hero.role)}
              </span>
            </div>
            {isMyTurn && (
              <span className="text-xs text-primary font-bold animate-pulse ml-2 bg-primary/10 px-3 py-1 rounded-full">
                👆 轮到你出牌
              </span>
            )}
            {thinkingBotId === hero.id && (
              <span className="text-xs text-primary/70 font-bold animate-pulse ml-2">思考中...</span>
            )}
            {lastBotAction?.playerId === hero.id && (
              <span className="text-xs font-bold text-primary bg-primary/15 px-3 py-1 rounded-full border border-primary/20 ml-2 animate-fade-in">
                {lastBotAction.action}
              </span>
            )}
            <span className="text-[10px] text-white/25 ml-auto tabular-nums">{hero.hand.length} 张</span>
          </div>

          {/* 手牌 */}
          <div className="flex flex-wrap gap-1 justify-center pb-2 min-h-[80px]">
            {sortedHand.map((card, i) => (
              <DdzCardView
                key={`${card.rank}-${card.suit}-${i}`}
                card={card}
                selected={selectedIndices.has(i)}
                onClick={isMyTurn ? () => toggleCard(i) : undefined}
              />
            ))}
            {hero.hand.length === 0 && (
              <span className="text-white/20 text-sm py-6">已出完</span>
            )}
          </div>

          {/* 操作按钮 */}
          {isMyTurn && state.phase === 'playing' && (
            <div className="flex justify-center gap-3 mt-1">
              {canPass && (
                <button
                  onClick={handlePass}
                  className="px-7 py-2.5 bg-white/5 text-white/60 border border-white/10 rounded-xl font-bold text-sm hover:bg-white/10 transition-all active:scale-95"
                >
                  不出
                </button>
              )}
              <button
                onClick={handlePlay}
                disabled={selectedIndices.size === 0}
                className="px-9 py-2.5 bg-gradient-to-r from-primary to-emerald-500 text-white rounded-xl font-bold text-sm shadow-lg shadow-primary/25 hover:brightness-110 transition-all active:scale-95 disabled:opacity-20 disabled:shadow-none flex items-center gap-2"
              >
                <span className="material-symbols-outlined text-base" style={{ fontVariationSettings: "'FILL' 1" }}>play_arrow</span>
                出牌
              </button>
              <button
                onClick={() => setSelectedIndices(new Set())}
                className="px-5 py-2.5 text-white/40 text-sm hover:text-white/70 transition-colors"
              >
                重选
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** 对手座位 */
function OpponentSeat({ player, isCurrentTurn, lastPlay, showCards, isThinking, thinkingContent, actionLabel }: {
  player: DdzPlayer
  isCurrentTurn: boolean
  lastPlay: CardCombo | null
  showCards?: boolean
  isThinking?: boolean
  thinkingContent?: string
  actionLabel?: string
}) {
  return (
    <div className={`flex flex-col items-center gap-2 px-5 py-3 rounded-2xl transition-all relative ${
      isCurrentTurn ? 'bg-white/[0.04] ring-1 ring-primary/30' : ''
    }`}>
      {/* 思维气泡 */}
      <ThinkingBubble content={thinkingContent} isThinking={!!isThinking} />

      {/* 头像 */}
      <div className="relative">
        <div className={`w-12 h-12 rounded-full flex items-center justify-center border-2 transition-all ${
          isCurrentTurn
            ? 'bg-primary/15 border-primary shadow-md shadow-primary/20'
            : 'bg-surface-container-high/30 border-white/10'
        }`}>
          {isThinking ? (
            <div className="flex gap-0.5">
              <span className="w-1 h-1 rounded-full bg-primary animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1 h-1 rounded-full bg-primary animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1 h-1 rounded-full bg-primary animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          ) : (
            <span className="text-lg">{roleIcon(player.role)}</span>
          )}
        </div>
        {isCurrentTurn && (
          <div className="absolute -bottom-0.5 left-1/2 -translate-x-1/2">
            <span className="w-2 h-2 rounded-full bg-primary block animate-ping" />
          </div>
        )}
      </div>

      {/* 名字 */}
      <div className="text-center">
        <span className={`text-xs font-bold ${isCurrentTurn ? 'text-primary' : 'text-white/70'}`}>{player.name}</span>
        <span className={`text-[10px] ml-1 ${player.role === 'landlord' ? 'text-amber-400/60' : 'text-emerald-400/60'}`}>
          {player.role === 'landlord' ? '地主' : player.role === 'peasant' ? '农民' : ''}
        </span>
      </div>

      {/* 行动标签 — 短暂显示最近操作 */}
      {actionLabel && (
        <span className="text-xs font-bold text-primary bg-primary/15 px-3 py-1 rounded-full border border-primary/20 animate-fade-in">
          {actionLabel}
        </span>
      )}

      {/* 手牌 */}
      {showCards ? (
        <div className="flex flex-wrap gap-0.5 justify-center max-w-[260px]">
          {sortCards(player.hand).map((c, i) => (
            <DdzCardView key={`${c.rank}-${c.suit}-${i}`} card={c} small />
          ))}
          {player.hand.length === 0 && <span className="text-white/20 text-[10px]">已出完</span>}
        </div>
      ) : (
        player.hand.length > 0
          ? <DdzCardBack count={player.hand.length} />
          : <span className="text-white/20 text-[10px]">已出完</span>
      )}

      {/* 出牌 */}
      {lastPlay && (
        <div className="mt-1">
          <PlayedCombo combo={lastPlay} />
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════
// DdzSetup
// ═══════════════════════════════════════════

export function DdzSetup({ config, onChange }: {
  config: { playerNames: string[]; baseScore: number; sessionId: string }
  onChange: (config: { playerNames: string[]; baseScore: number; sessionId: string }) => void
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div className="bg-surface-container-low p-5 rounded-xl space-y-3">
        <label className="text-xs font-bold uppercase tracking-widest text-on-surface-variant flex items-center gap-2">
          <span className="material-symbols-outlined text-sm">toll</span>
          底分
        </label>
        <input
          type="number"
          value={config.baseScore}
          min={1}
          max={100}
          onChange={(e) => onChange({ ...config, baseScore: Number(e.target.value) || 1 })}
          className="w-full bg-surface-container-high border-none rounded text-on-surface py-2 px-4 focus:ring-1 focus:ring-primary"
        />
        <p className="text-[10px] text-on-surface-variant/60">每局基础分值</p>
      </div>
      <div className="bg-surface-container-low p-5 rounded-xl space-y-3">
        <label className="text-xs font-bold uppercase tracking-widest text-on-surface-variant flex items-center gap-2">
          <span className="material-symbols-outlined text-sm">info</span>
          规则
        </label>
        <div className="text-sm text-on-surface-variant leading-relaxed">
          单张 · 对子 · 三带一/对 · 顺子 · 炸弹 · 火箭<br/>
          炸弹/火箭翻倍
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════
// DdzHistory
// ═══════════════════════════════════════════

export function DdzHistory() {
  return (
    <div className="space-y-6">
      <div className="text-center py-12">
        <span className="material-symbols-outlined text-4xl text-on-surface/15 block mb-3">history</span>
        <h3 className="font-headline font-bold text-lg text-on-surface/60">对局历史</h3>
        <p className="text-sm text-on-surface-variant/40 mt-1">完成一局斗地主后，对局记录将显示在这里</p>
      </div>
    </div>
  )
}
