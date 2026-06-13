import { useEffect, useState } from 'react'
import { useAppStore } from '../store/app-store'
import { useGameStore } from '../store/game-store'
import { useActionQueue } from '../hooks/useActionQueue'
import { Navbar } from '../components/layout/Navbar'
// Sidebar is now rendered globally in App.tsx
import { PokerTable } from '../components/game/PokerTable'
import { ActionPanel } from '../components/game/ActionPanel'
import { PlayerActionLog, SpectatorActionLog } from '../components/game/ActionLog'
import { SpectatorControls } from '../components/game/SpectatorControls'
import { GameFooter } from '../components/game/GameFooter'
import { ImpressionToggle, ImpressionDrawer } from '../components/game/ImpressionPanel'
import { ThinkingOverlay } from '../components/game/ThinkingBubble'
import { RankingPanel, EndGameButton } from '../components/game/RankingPanel'
import type { Player as EnginePlayer } from '../types/player'
import type { Card } from '../types/card'
import type { GameState } from '../types/game'
import type { Player as MockPlayer, CardData, ActionLogEntry, PhaseHeader, ProbabilityEntry } from '../types/ui'

// ---------- Helpers ----------

const SEAT_POSITIONS: MockPlayer['position'][] = [
  'bottom', 'bottom-left', 'top-left', 'top', 'top-right', 'bottom-right'
]

const PHASE_NAMES: Record<string, string> = {
  waiting: '等待', preflop: '翻前', flop: '翻牌', turn: '转牌', river: '河牌', showdown: '摊牌',
}

function cardToDisplay(card: Card): string {
  const suitMap: Record<string, string> = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' }
  const rankMap: Record<string, string> = { T: '10', J: 'J', Q: 'Q', K: 'K', A: 'A' }
  return `${rankMap[card.rank] || card.rank}${suitMap[card.suit]}`
}

function cardToCardData(card: Card): CardData {
  const suitMap: Record<string, 'heart' | 'diamond' | 'club' | 'spade'> = { hearts: 'heart', diamonds: 'diamond', clubs: 'club', spades: 'spade' }
  const rankMap: Record<string, string> = { T: '10' }
  return { rank: rankMap[card.rank] || card.rank, suit: suitMap[card.suit] }
}

function formatActionLabel(action: { type: string; amount?: number }): string {
  switch (action.type) {
    case 'fold': return '弃牌'
    case 'check': return '过牌'
    case 'call': return `跟注 $${action.amount || 0}`
    case 'bet': return `下注 $${action.amount || 0}`
    case 'raise': return `加注 $${action.amount || 0}`
    case 'allIn': return `ALL IN $${action.amount || 0}`
    case 'postSmallBlind': return `SB $${action.amount || 0}`
    case 'postBigBlind': return `BB $${action.amount || 0}`
    default: return action.type
  }
}

/** Compute D/SB/BB badge for a player */
function getBadge(player: EnginePlayer, gameState: GameState): string | null {
  const dealerSeatIndex = gameState.dealerIndex  // Now stores seatIndex
  const activePlayers = gameState.players
    .filter(p => p.status !== 'sittingOut' && p.status !== 'eliminated')
    .sort((a, b) => {
      const offsetA = (a.seatIndex - dealerSeatIndex + 6) % 6
      const offsetB = (b.seatIndex - dealerSeatIndex + 6) % 6
      return offsetA - offsetB
    })
  const isHeadsUp = activePlayers.length === 2

  if (player.seatIndex === dealerSeatIndex) {
    return isHeadsUp ? 'D/SB' : 'D'
  }

  // activePlayers[0] = dealer, [1] = SB (or BB in HU), [2] = BB
  if (!isHeadsUp && activePlayers[1]?.seatIndex === player.seatIndex) return 'SB'
  if (isHeadsUp && activePlayers[1]?.seatIndex === player.seatIndex) return 'BB'
  if (!isHeadsUp && activePlayers[2]?.seatIndex === player.seatIndex) return 'BB'
  return null
}

function enginePlayerToMock(
  player: EnginePlayer,
  isHero: boolean,
  showCards: boolean,
  thinkingBotId: string | null,
  llmThoughts: Record<string, string>,
  gameState: GameState | null,
  lastBotAction: { playerId: string; action: { type: string; amount?: number } } | null = null,
): MockPlayer {
  const cards = (isHero || showCards) && player.holeCards.length === 2
    ? player.holeCards.map(c => cardToDisplay(c))
    : null

  const borderMap: Record<string, string> = { human: 'tertiary', llm: 'on-tertiary-container', bot: 'secondary' }

  let thinking: string | null = null
  if (player.status !== 'folded' && thinkingBotId === player.id) {
    if (showCards) {
      // 上帝模式：显示完整思维链
      thinking = llmThoughts[player.id] || '思考中...'
    } else {
      // 玩家模式：对手只显示"思考中..."指示器，不暴露内容
      thinking = '思考中...'
    }
  }
  // Completed thinking content now lives in the right-panel thinkingChain, not in table bubbles

  const badge = gameState ? getBadge(player, gameState) : null
  const currentPlayer = gameState ? gameState.players.find(p => p.seatIndex === gameState.currentPlayerIndex) : null
  const isActive = gameState ? currentPlayer?.id === player.id && gameState.phase !== 'showdown' && gameState.phase !== 'waiting' : false

  return {
    id: player.id,
    name: player.name,
    type: player.type,
    chips: player.chips,
    cards,
    position: SEAT_POSITIONS[player.seatIndex % SEAT_POSITIONS.length],
    borderColor: borderMap[player.type] || 'outline-variant',
    thinking,
    folded: player.status === 'folded',
    eliminated: player.status === 'eliminated',
    badge,
    currentBet: player.currentBet,
    isActive,
    lastAction: lastBotAction && lastBotAction.playerId === player.id
      ? { type: lastBotAction.action.type, label: formatActionLabel(lastBotAction.action) }
      : null,
  }
}

// ---------- AI Competition Prompt Dialog ----------

function AiCompetitionDialog({ onManual, onAutoPlay }: { onManual: () => void; onAutoPlay: () => void }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-surface-container-high border border-outline-variant/20 rounded-2xl shadow-2xl p-8 max-w-md w-full mx-4 space-y-6 animate-in fade-in zoom-in-95">
        <div className="text-center space-y-2">
          <span className="material-symbols-outlined text-4xl text-tertiary">smart_toy</span>
          <h2 className="font-headline text-xl font-bold text-on-surface">检测到全 AI 对局</h2>
          <p className="text-sm text-on-surface-variant">当前桌上没有人类玩家，是否开启 AI 竞技模式？</p>
        </div>
        <div className="space-y-3">
          <button
            onClick={onAutoPlay}
            className="w-full bg-tertiary text-on-tertiary font-bold py-3 rounded-xl flex items-center justify-center gap-2 hover:bg-tertiary-container transition-all active:scale-[0.98] shadow-lg"
          >
            <span className="material-symbols-outlined text-lg">bolt</span>
            AI 竞技模式
            <span className="text-xs opacity-70 ml-1">— 自动连续对局</span>
          </button>
          <button
            onClick={onManual}
            className="w-full bg-primary text-on-primary font-bold py-3 rounded-xl flex items-center justify-center gap-2 hover:bg-primary-container transition-all active:scale-[0.98]"
          >
            <span className="material-symbols-outlined text-lg">play_arrow</span>
            手动发牌
            <span className="text-xs opacity-70 ml-1">— 每手手动控制</span>
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------- Player View ----------

function PlayerView() {
  const { toggleGameMode } = useAppStore()
  const {
    gameState, availableActions, statusText,
    tipMessage, tipVisible, dismissTip,
    thinkingBotId, llmThoughts, isRunning,
    impressions, impressionHistory,
    startNewHand, playerAction,
    autoPlay, setAutoPlay, autoPlayHandCount,
    showRanking, initialChipsMap, endGame, dismissRanking, resetGame,
  } = useGameStore()
  const lastBotAction = useGameStore(s => s.lastBotAction)
  useActionQueue()
  const [showImpressions, setShowImpressions] = useState(false)
  const [expandedThinking, setExpandedThinking] = useState<{ name: string; content: string } | null>(null)
  const [aiDialogDismissed, setAiDialogDismissed] = useState(false)

  const heroId = gameState?.players.find(p => p.type === 'human')?.id
  const heroPlayer = gameState?.players.find(p => p.type === 'human')
  const isAllNonHuman = (gameState?.players || []).every(p => p.type !== 'human')

  // Show AI competition dialog when: waiting phase, all non-human, and not yet dismissed
  const isWaitingPhase = gameState?.phase === 'waiting' || !gameState
  const showAiDialog = isWaitingPhase && isAllNonHuman && !aiDialogDismissed && !autoPlay

  // Auto-deal first hand for human games (no dialog needed)
  useEffect(() => {
    if (gameState?.phase === 'waiting' && !isAllNonHuman) {
      startNewHand()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState?.phase, isAllNonHuman])

  const players: MockPlayer[] = (gameState?.players || []).map((p) =>
    enginePlayerToMock(p, p.id === heroId, false, thinkingBotId, llmThoughts, gameState, lastBotAction)
  )

  const communityCards: CardData[] = gameState
    ? [...gameState.communityCards.map(c => cardToCardData(c)), ...Array(5 - gameState.communityCards.length).fill(null)]
    : [null, null, null, null, null]

  const pot = gameState?.pot || 0
  const sidePots = gameState?.sidePots
  const phase = gameState ? PHASE_NAMES[gameState.phase] || gameState.phase : undefined

  // Build action log
  const actionLog: (ActionLogEntry | PhaseHeader)[] = []
  if (gameState) {
    let currentPhase = ''
    for (const action of gameState.actionHistory) {
      const phaseName = PHASE_NAMES[gameState.phase] || gameState.phase
      if (phaseName !== currentPhase) {
        currentPhase = phaseName
        actionLog.push({ phase: currentPhase, phaseColor: 'on-surface-variant', phaseBg: 'surface-container' } as PhaseHeader)
      }
      const player = gameState.players.find(p => p.id === action.playerId)
      const borderMap: Record<string, string> = { human: 'tertiary', llm: 'on-tertiary-container', bot: 'secondary' }
      const actionNames: Record<string, string> = {
        postSmallBlind: `支付小盲注 $${action.amount}`, postBigBlind: `支付大盲注 $${action.amount}`,
        fold: '弃牌', check: '过牌', call: `跟注 $${action.amount}`, bet: `下注 $${action.amount}`, raise: `加注到 $${action.amount}`, allIn: `全下 $${action.amount}`,
      }
      actionLog.push({ playerName: player?.name || action.playerId, playerColor: borderMap[player?.type || 'bot'] || 'secondary', action: actionNames[action.type] || action.type } as ActionLogEntry)
    }
  }

  const heroCards = heroPlayer && heroPlayer.holeCards.length === 2
    ? heroPlayer.holeCards.map(c => cardToDisplay(c)).join(' ') : ''
  const highestBet = gameState ? Math.max(...gameState.players.map(p => p.currentBet)) : 0
  const amountToCall = heroPlayer ? Math.max(0, highestBet - heroPlayer.currentBet) : 0
  const isShowdown = gameState?.phase === 'showdown'
  const isWaiting = gameState?.phase === 'waiting' || !gameState

  const impressionCount = Object.values(impressions).reduce((s, imp) => s + Object.keys(imp).length, 0)

  return (
    <div className="bg-background text-on-surface font-body h-screen flex flex-col overflow-hidden">
      <Navbar />
      <main className="flex-1 flex relative overflow-hidden">
        <div className="ml-20 flex-1 flex">
          <div className="flex-grow relative flex items-center justify-center p-12">
            {/* Top-right controls */}
            <div className="absolute top-8 right-8 flex items-center gap-3 z-10">
              <EndGameButton onEndGame={endGame} />
              <ImpressionToggle isOpen={showImpressions} onToggle={() => setShowImpressions(!showImpressions)} count={impressionCount} />
              <button onClick={toggleGameMode} className="flex items-center space-x-2 glass-panel px-4 py-2 rounded-full hover:bg-surface-container-highest transition-all group">
                <span className="material-symbols-outlined text-tertiary group-hover:scale-110 transition-transform">visibility</span>
                <span className="text-xs font-label uppercase tracking-wider font-semibold">上帝视角</span>
              </button>
            </div>

            {/* Status */}
            <div className="absolute top-8 left-8 z-10 text-sm text-on-surface-variant">{statusText}</div>

            {/* Dismissable tip banner */}
            {tipVisible && tipMessage && (
              <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-20 bg-surface-container-high/95 backdrop-blur-sm border border-primary/30 text-on-surface px-5 py-2.5 rounded-xl shadow-xl flex items-center gap-3 max-w-lg animate-in fade-in slide-in-from-bottom-2">
                <span className="material-symbols-outlined text-primary text-sm">info</span>
                <span className="text-sm font-medium flex-1">{tipMessage}</span>
                <button onClick={dismissTip} className="p-0.5 hover:bg-surface-container-highest rounded-lg transition-colors flex-shrink-0">
                  <span className="material-symbols-outlined text-on-surface-variant text-sm">close</span>
                </button>
              </div>
            )}

            {/* Deal / Next hand / AutoPlay controls */}
            {autoPlay && (
              <div className="absolute top-8 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-2">
                <div className="bg-tertiary/20 border border-tertiary/40 text-tertiary px-4 py-1.5 rounded-full text-sm font-bold flex items-center gap-2 animate-pulse">
                  <span className="material-symbols-outlined text-sm">bolt</span>
                  AI 竞技中 — 第 {autoPlayHandCount} 手
                </div>
                <button
                  onClick={() => setAutoPlay(false)}
                  className="bg-amber-600 text-white font-bold px-4 py-1.5 rounded-lg hover:bg-amber-700 transition-all active:scale-95 text-sm flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-sm">pause</span>
                  暂停竞技
                </button>
              </div>
            )}
            {isRunning && (isShowdown || isWaiting) && !autoPlay && (
              <div className="absolute top-8 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2">
                <button onClick={() => startNewHand()} className="bg-primary text-on-primary font-bold px-6 py-2 rounded-lg hover:bg-primary-container transition-all active:scale-95">
                  {isWaiting ? '发牌' : '下一手'}
                </button>
                {isAllNonHuman && autoPlayHandCount > 0 && (
                  <button
                    onClick={() => { setAutoPlay(true); startNewHand() }}
                    className="bg-tertiary text-on-tertiary font-bold px-4 py-2 rounded-lg hover:bg-tertiary-container transition-all active:scale-95 flex items-center gap-1"
                  >
                    <span className="material-symbols-outlined text-sm">play_arrow</span>
                    继续竞技
                  </button>
                )}
                {isAllNonHuman && autoPlayHandCount === 0 && (
                  <button
                    onClick={() => { setAutoPlay(true); startNewHand() }}
                    className="bg-tertiary text-on-tertiary font-bold px-4 py-2 rounded-lg hover:bg-tertiary-container transition-all active:scale-95 flex items-center gap-1"
                  >
                    <span className="material-symbols-outlined text-sm">bolt</span>
                    AI 竞技
                  </button>
                )}
              </div>
            )}

            <PokerTable players={players} communityCards={communityCards} pot={pot} sidePots={sidePots} mode="player" heroId={heroId} phase={phase} />
          </div>

          {/* Right sidebar — action log with thinking chain */}
          <aside className="w-80 h-full bg-surface-container-low border-l border-outline-variant/10 flex flex-col shadow-2xl">
            <PlayerActionLog entries={actionLog} thinkingChain={[]} />
          </aside>

          <ImpressionDrawer isOpen={showImpressions} onClose={() => setShowImpressions(false)} impressions={impressions} players={(gameState?.players || []).map(p => ({ id: p.id, name: p.name, type: p.type }))} sessionId={gameState?.sessionId || ''} handNumber={gameState?.handNumber || 0} impressionHistory={impressionHistory} />
        </div>

        {heroPlayer && !isShowdown && !isWaiting && availableActions.length > 0 && (
          <ActionPanel heroCards={heroCards} amountToCall={amountToCall} onAction={(type, amount) => playerAction(type, amount)} availableActions={availableActions} />
        )}
      </main>

      {/* Top-level thinking overlay (z-200, not blocked by anything) */}
      {expandedThinking && (
        <ThinkingOverlay playerName={expandedThinking.name} content={expandedThinking.content} onClose={() => setExpandedThinking(null)} />
      )}

      {/* Ranking panel */}
      {showRanking && gameState && (
        <RankingPanel
          players={gameState.players.map(p => ({
            id: p.id,
            name: p.name,
            type: p.type,
            chips: p.chips,
            initialChips: initialChipsMap[p.id] ?? p.chips,
          }))}
          handCount={gameState.handNumber}
          onClose={dismissRanking}
          onBackToSetup={() => { resetGame(); useAppStore.getState().setCurrentPage('setup') }}
        />
      )}
      {/* AI competition dialog — shown on first waiting phase when all players are AI */}
      {showAiDialog && (
        <AiCompetitionDialog
          onManual={() => { setAiDialogDismissed(true); startNewHand() }}
          onAutoPlay={() => { setAiDialogDismissed(true); setAutoPlay(true); startNewHand() }}
        />
      )}
    </div>
  )
}

// ---------- Spectator Mode ----------

function SpectatorView() {
  const { setGameMode } = useAppStore()
  const { gameState, engine, statusText, tipMessage, tipVisible, dismissTip, thinkingBotId, llmThoughts, isRunning, impressions, impressionHistory, startNewHand, autoPlay, setAutoPlay, autoPlayHandCount, playerEquities, showRanking, initialChipsMap, endGame, dismissRanking, resetGame: resetGameStore, thinkingChain, prevHandRanks, firstPlaceStreak, firstPlacePlayerId } = useGameStore()
  const lastBotAction = useGameStore(s => s.lastBotAction)
  useActionQueue()
  const [showImpressions, setShowImpressions] = useState(false)
  const [expandedThinking, setExpandedThinking] = useState<{ name: string; content: string } | null>(null)

  void engine

  const handNumber = gameState?.handNumber || 0
  const totalHands = engine?.getHandHistories().length || 0

  // Spectator always shows all cards
  const players: MockPlayer[] = (gameState?.players || []).map((p) =>
    enginePlayerToMock(p, false, true, thinkingBotId, llmThoughts, gameState, lastBotAction)
  )

  const communityCards: CardData[] = gameState
    ? [...gameState.communityCards.map(c => cardToCardData(c)), ...Array(5 - gameState.communityCards.length).fill(null)]
    : [null, null, null, null, null]

  const pot = gameState?.pot || 0
  const spectatorSidePots = gameState?.sidePots
  const phase = gameState ? PHASE_NAMES[gameState.phase] || gameState.phase : undefined
  const isShowdown = gameState?.phase === 'showdown'
  const isWaiting = gameState?.phase === 'waiting' || !gameState

  const actionLog: ActionLogEntry[] = (gameState?.actionHistory || []).map(action => {
    const player = gameState?.players.find(p => p.id === action.playerId)
    const borderMap: Record<string, string> = { human: 'tertiary', llm: 'tertiary', bot: 'secondary' }
    const actionNames: Record<string, string> = {
      postSmallBlind: `posted SB $${action.amount}`, postBigBlind: `posted BB $${action.amount}`,
      fold: 'folded', check: 'checked', call: `called $${action.amount}`, bet: `bet $${action.amount}`, raise: `raised to $${action.amount}`, allIn: `all-in $${action.amount}`,
    }
    return { playerName: player?.name || action.playerId, playerColor: borderMap[player?.type || 'bot'] || 'secondary', action: actionNames[action.type] || action.type }
  })

  const probabilityMatrix: ProbabilityEntry[] = (gameState?.players || [])
    .filter(p => p.status === 'active' || p.status === 'allIn')
    .map(p => {
      const equityData = playerEquities.find(e => e.playerId === p.id)
      return {
        name: p.name,
        winPercent: equityData ? Math.round(equityData.equity * 100) : 0,
        color: p.type === 'llm' ? 'tertiary' : 'secondary',
      }
    })

  const impressionCount = Object.values(impressions).reduce((s, imp) => s + Object.keys(imp).length, 0)

  const isAllNonHuman = (gameState?.players || []).every(p => p.type !== 'human')

  return (
    <div className="bg-background text-on-surface font-body h-screen w-full flex flex-col overflow-hidden">
      <Navbar rightSlot={<SpectatorControls handNumber={handNumber} totalHands={totalHands} sessionId={gameState?.sessionId} />} />
      <main className="flex-1 flex relative overflow-hidden">
        <div className="ml-20 flex-1 flex">
          <div className="flex-1 relative poker-table-gradient-spectator flex flex-col items-center justify-center p-8">
            <div className="absolute top-4 left-8 z-10 text-sm text-on-surface-variant">{statusText}</div>
            <div className="absolute top-4 right-8 z-10 flex items-center gap-3">
              <EndGameButton onEndGame={endGame} />
              <ImpressionToggle isOpen={showImpressions} onToggle={() => setShowImpressions(!showImpressions)} count={impressionCount} />
              <button onClick={() => setGameMode('player')} className="flex items-center space-x-2 glass-panel px-4 py-2 rounded-full hover:bg-surface-container-highest transition-all group">
                <span className="material-symbols-outlined text-tertiary group-hover:scale-110 transition-transform">visibility_off</span>
                <span className="text-xs font-label uppercase tracking-wider font-semibold">退出上帝视角</span>
              </button>
            </div>

            {/* AutoPlay banner */}
            {autoPlay && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 bg-tertiary/20 border border-tertiary/40 text-tertiary px-4 py-1.5 rounded-full text-sm font-bold flex items-center gap-2 animate-pulse">
                <span className="material-symbols-outlined text-sm">bolt</span>
                AI 竞技中 — 第 {autoPlayHandCount} 手
              </div>
            )}

            {isRunning && (isShowdown || isWaiting) && !autoPlay && (
              <div className="absolute top-12 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2">
                <button onClick={() => startNewHand()} className="bg-primary text-on-primary font-bold px-6 py-2 rounded-lg hover:bg-primary-container transition-all active:scale-95">
                  {isWaiting ? '发牌' : '下一手'}
                </button>
                {isAllNonHuman && autoPlayHandCount > 0 && (
                  <button
                    onClick={() => { setAutoPlay(true); startNewHand() }}
                    className="bg-tertiary text-on-tertiary font-bold px-4 py-2 rounded-lg hover:bg-tertiary-container transition-all active:scale-95 flex items-center gap-1"
                  >
                    <span className="material-symbols-outlined text-sm">play_arrow</span>
                    继续竞技
                  </button>
                )}
                {isAllNonHuman && autoPlayHandCount === 0 && (
                  <button
                    onClick={() => { setAutoPlay(true); startNewHand() }}
                    className="bg-tertiary text-on-tertiary font-bold px-4 py-2 rounded-lg hover:bg-tertiary-container transition-all active:scale-95 flex items-center gap-1"
                  >
                    <span className="material-symbols-outlined text-sm">bolt</span>
                    AI 竞技
                  </button>
                )}
              </div>
            )}

            {autoPlay && (
              <button
                onClick={() => setAutoPlay(false)}
                className="absolute top-12 left-1/2 -translate-x-1/2 z-10 bg-amber-600 text-white font-bold px-6 py-2 rounded-lg hover:bg-amber-700 transition-all active:scale-95 flex items-center gap-1"
              >
                <span className="material-symbols-outlined text-sm">pause</span>
                暂停竞技
              </button>
            )}
            <PokerTable players={players} communityCards={communityCards} pot={pot} sidePots={spectatorSidePots} mode="spectator" phase={phase} />

            {/* Dismissable tip banner */}
            {tipVisible && tipMessage && (
              <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-20 bg-surface-container-high/95 backdrop-blur-sm border border-primary/30 text-on-surface px-5 py-2.5 rounded-xl shadow-xl flex items-center gap-3 max-w-lg">
                <span className="material-symbols-outlined text-primary text-sm">info</span>
                <span className="text-sm font-medium flex-1">{tipMessage}</span>
                <button onClick={dismissTip} className="p-0.5 hover:bg-surface-container-highest rounded-lg transition-colors flex-shrink-0">
                  <span className="material-symbols-outlined text-on-surface-variant text-sm">close</span>
                </button>
              </div>
            )}
          </div>

          <SpectatorActionLog
            entries={actionLog}
            probabilityMatrix={probabilityMatrix}
            thinkingChain={thinkingChain}
            onThinkingClick={(entry) => setExpandedThinking({ name: entry.playerName, content: entry.content })}
            rankingPlayers={(gameState?.players || []).map(p => ({ id: p.id, name: p.name, type: p.type, chips: p.chips }))}
            prevHandRanks={prevHandRanks}
            firstPlaceStreak={firstPlaceStreak}
            firstPlacePlayerId={firstPlacePlayerId}
          />
          <ImpressionDrawer isOpen={showImpressions} onClose={() => setShowImpressions(false)} impressions={impressions} players={(gameState?.players || []).map(p => ({ id: p.id, name: p.name, type: p.type }))} sessionId={gameState?.sessionId || ''} handNumber={gameState?.handNumber || 0} impressionHistory={impressionHistory} />
        </div>
      </main>
      <GameFooter handNumber={handNumber} totalHands={totalHands} mode="LLM Arena" sessionId={gameState?.sessionId} />

      {expandedThinking && (
        <ThinkingOverlay playerName={expandedThinking.name} content={expandedThinking.content} onClose={() => setExpandedThinking(null)} />
      )}

      {/* Ranking panel */}
      {showRanking && gameState && (
        <RankingPanel
          players={gameState.players.map(p => ({
            id: p.id,
            name: p.name,
            type: p.type,
            chips: p.chips,
            initialChips: initialChipsMap[p.id] ?? p.chips,
          }))}
          handCount={gameState.handNumber}
          onClose={dismissRanking}
          onBackToSetup={() => { resetGameStore(); useAppStore.getState().setCurrentPage('setup') }}
        />
      )}
    </div>
  )
}

// ---------- No Game View ----------

function NoGameView() {
  const setCurrentPage = useAppStore((s) => s.setCurrentPage)
  return (
    <div className="bg-background text-on-surface font-body h-screen flex flex-col overflow-hidden">
      <Navbar />
      <main className="flex-1 flex items-center justify-center ml-20">
        <div className="text-center space-y-4">
          <span className="material-symbols-outlined text-6xl text-on-surface-variant">casino</span>
          <h2 className="font-headline text-2xl font-bold">尚未开始游戏</h2>
          <p className="text-on-surface-variant">请先在配置页面设置座位并开始游戏</p>
          <button onClick={() => setCurrentPage('setup')} className="bg-primary text-on-primary px-6 py-3 rounded-lg font-bold hover:bg-primary-container transition-all active:scale-95">前往配置</button>
        </div>
      </main>
    </div>
  )
}

// ---------- GamePage Entry ----------

export function GamePage() {
  const gameMode = useAppStore((s) => s.gameMode)
  const isRunning = useGameStore((s) => s.isRunning)

  if (!isRunning) return <NoGameView />
  if (gameMode === 'spectator') return <SpectatorView />
  return <PlayerView />
}
