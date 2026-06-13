/**
 * DdzGamePage — 斗地主完整游戏页面。
 *
 * 独立于 poker 的 GamePage，使用 ddz-game-store。
 * 复用通用组件: ActionLog（PlayerActionLog/SpectatorActionLog）、ThinkingBubble 设计模式。
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { useAppStore } from '../../../store/app-store'
import { useDdzGameStore } from '../store/ddz-game-store'
import { DdzBoard } from './index'
import { Navbar } from '../../../components/layout/Navbar'
import { PlayerActionLog, SpectatorActionLog } from '../../../components/game/ActionLog'
import type { ThinkingChainEntry } from '../../../components/game/ActionLog'
import type { ActionLogEntry } from '../../../types/ui'
import { ThinkingOverlay } from '../../../components/game/ThinkingBubble'

// ── DDZ Action Queue (同 useActionQueue 模式) ──

function useDdzActionQueue() {
  const isProcessingRef = useRef(false)
  const isBotActing = useDdzGameStore(s => s.isBotActing)

  const startProcessing = useCallback(() => {
    if (isProcessingRef.current) return
    isProcessingRef.current = true
    useDdzGameStore.getState().processNextAction().finally(() => {
      isProcessingRef.current = false
    })
  }, [])

  useEffect(() => {
    if (isBotActing && !isProcessingRef.current) {
      startProcessing()
    }
  }, [isBotActing, startProcessing])
}

// ── Main Page ──

export function DdzGamePage() {
  const gameMode = useAppStore(s => s.gameMode)
  const setGameMode = useAppStore(s => s.setGameMode)

  const gameState = useDdzGameStore(s => s.gameState)
  const isRunning = useDdzGameStore(s => s.isRunning)
  const statusText = useDdzGameStore(s => s.statusText)
  const thinkingBotId = useDdzGameStore(s => s.thinkingBotId)
  const llmThoughts = useDdzGameStore(s => s.llmThoughts)
  const thinkingChain = useDdzGameStore(s => s.thinkingChain)
  const actionLog = useDdzGameStore(s => s.actionLog)
  const autoPlay = useDdzGameStore(s => s.autoPlay)
  const showRanking = useDdzGameStore(s => s.showRanking)
  const lastBotAction = useDdzGameStore(s => s.lastBotAction)
  const scoreMap = useDdzGameStore(s => s.scoreMap)
  const scoreHistory = useDdzGameStore(s => s.scoreHistory)

  const playerAction = useDdzGameStore(s => s.playerAction)
  const startNewRound = useDdzGameStore(s => s.startNewRound)
  const setAutoPlay = useDdzGameStore(s => s.setAutoPlay)
  const endGame = useDdzGameStore(s => s.endGame)
  const dismissRanking = useDdzGameStore(s => s.dismissRanking)
  const resetGame = useDdzGameStore(s => s.resetGame)
  const viewAsPlayerIndex = useDdzGameStore(s => s.viewAsPlayerIndex)
  const setViewAsPlayer = useDdzGameStore(s => s.setViewAsPlayer)

  // 展开的思考内容
  const [expandedThinking, setExpandedThinking] = useState<{ name: string; content: string } | null>(null)
  const [showEndConfirm, setShowEndConfirm] = useState(false)

  // 启动 action queue
  useDdzActionQueue()

  const isGodMode = gameMode === 'spectator'

  // 是否为纯 AI 模式（无 human 玩家）→ 可切换视角
  const isAllAI = gameState ? gameState.players.every(p => p.type !== 'human') : false

  // 转换 actionLog 为 ActionLogEntry 格式（兼容通用 ActionLog 组件）
  const formattedActionLog: ActionLogEntry[] = actionLog.map(e => ({
    playerName: e.playerName,
    playerColor: 'primary',
    action: e.action,
    highlight: e.highlight,
  }))

  // 转换 thinkingChain 为通用格式
  const formattedThinkingChain: ThinkingChainEntry[] = thinkingChain

  return (
    <div className="ml-20 bg-background text-on-surface font-body min-h-screen flex flex-col">
      {/* Navbar + 工具栏 */}
      <Navbar rightSlot={
        <div className="flex items-center gap-2">
          {/* 上帝模式 */}
          <button
            onClick={() => setGameMode(isGodMode ? 'player' : 'spectator')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              isGodMode
                ? 'bg-secondary text-on-secondary'
                : 'bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest'
            }`}
          >
            <span className="material-symbols-outlined text-sm mr-1" style={{ fontVariationSettings: "'FILL' 1" }}>
              {isGodMode ? 'visibility' : 'visibility_off'}
            </span>
            {isGodMode ? '上帝模式' : '玩家模式'}
          </button>

          {/* 视角切换 (纯AI模式) */}
          {isAllAI && gameState && (
            <div className="flex items-center gap-1 bg-surface-container rounded-lg px-1 py-0.5">
              <span className="text-[10px] text-on-surface-variant/60 px-1">视角</span>
              {gameState.players.map((p, i) => (
                <button
                  key={p.id}
                  onClick={() => setViewAsPlayer(i)}
                  className={`px-2 py-1 rounded text-[11px] font-bold transition-all ${
                    viewAsPlayerIndex === i
                      ? 'bg-primary text-on-primary'
                      : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high'
                  }`}
                >
                  {p.name}
                </button>
              ))}
            </div>
          )}

          {/* AutoPlay */}
          <button
            onClick={() => setAutoPlay(!autoPlay)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              autoPlay
                ? 'bg-primary text-on-primary'
                : 'bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest'
            }`}
          >
            <span className="material-symbols-outlined text-sm mr-1">
              {autoPlay ? 'pause' : 'fast_forward'}
            </span>
            {autoPlay ? '暂停' : '自动'}
          </button>

          {/* 结束游戏 */}
          <button
            onClick={() => setShowEndConfirm(true)}
            className="px-3 py-1.5 rounded-lg text-xs font-bold bg-error/10 text-error hover:bg-error/20 transition-all"
          >
            结束
          </button>
        </div>
      } />

      {/* 主体 */}
      <div className="flex-1 flex">
        {/* 左侧：牌桌 */}
        <div className="flex-1 flex flex-col">
          <DdzBoard
            gameState={gameState}
            onAction={playerAction}
            thinkingBotId={thinkingBotId}
            llmThoughts={llmThoughts}
            viewAsPlayerIndex={viewAsPlayerIndex}
            lastBotAction={lastBotAction}
          />

          {/* 底部状态栏 */}
          <div className="px-6 py-3 bg-surface-container-low border-t border-outline-variant/10 flex items-center justify-between">
            <span className="text-sm text-on-surface-variant">{statusText}</span>
            <div className="flex gap-2">
              {lastBotAction && (
                <span className="text-xs bg-primary/10 text-primary px-3 py-1 rounded-full font-bold">
                  {lastBotAction.action}
                </span>
              )}
              {isRunning && gameState?.phase === 'finished' && !autoPlay && (
                <button
                  onClick={startNewRound}
                  className="px-4 py-2 bg-primary text-on-primary rounded-lg text-sm font-bold hover:bg-primary-container transition-all active:scale-95 flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-base" style={{ fontVariationSettings: "'FILL' 1" }}>replay</span>
                  下一局
                </button>
              )}
            </div>
          </div>
        </div>

        {/* 右侧面板：复用通用 ActionLog 组件 */}
        <aside className="w-80 h-full bg-surface-container-low border-l border-outline-variant/10 flex flex-col shadow-2xl">
          {isGodMode ? (
            <SpectatorActionLog
              entries={formattedActionLog}
              thinkingChain={formattedThinkingChain}
              onThinkingClick={(entry) => setExpandedThinking({ name: entry.playerName, content: entry.content })}
            />
          ) : (
            <PlayerActionLog
              entries={formattedActionLog}
              thinkingChain={formattedThinkingChain}
              onThinkingClick={(entry) => setExpandedThinking({ name: entry.playerName, content: entry.content })}
            />
          )}
        </aside>
      </div>

      {/* 思考展开弹窗 */}
      {expandedThinking && (
        <ThinkingOverlay
          playerName={expandedThinking.name}
          content={expandedThinking.content}
          onClose={() => setExpandedThinking(null)}
        />
      )}

      {/* 排名弹窗 */}
      {showRanking && gameState && (
        <DdzRankingOverlay
          state={gameState}
          scoreMap={scoreMap}
          scoreHistory={scoreHistory}
          onDismiss={dismissRanking}
          onNewRound={startNewRound}
          onExit={() => { resetGame(); useAppStore.getState().setCurrentPage('setup') }}
        />
      )}

      {/* 结束游戏确认弹窗 */}
      {showEndConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-surface-container-low rounded-2xl p-8 max-w-sm w-full mx-4 shadow-2xl space-y-6">
            <div className="text-center">
              <div className="text-4xl mb-2">❓</div>
              <h2 className="text-xl font-black font-headline text-on-surface">
                确认结束游戏
              </h2>
              <p className="text-sm text-on-surface-variant mt-2">
                这将立即结束当前对局。确认继续吗？
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowEndConfirm(false)}
                className="flex-1 py-3 bg-surface-container text-on-surface-variant font-bold rounded-xl hover:bg-surface-container-high transition-all active:scale-95"
              >
                取消
              </button>
              <button
                onClick={() => { setShowEndConfirm(false); endGame() }}
                className="flex-1 py-3 bg-error text-on-error font-bold rounded-xl hover:bg-error-container transition-all active:scale-95"
              >
                确认结束
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── 排名弹窗 ──

function DdzRankingOverlay({ state, scoreMap, scoreHistory, onDismiss, onNewRound, onExit }: {
  state: import('../engine/ddz-types').DdzGameState
  scoreMap: Record<string, number>
  scoreHistory: Array<{ round: number; scores: Record<string, number> }>
  onDismiss: () => void
  onNewRound: () => void
  onExit: () => void
}) {
  const winner = state.players.find(p => p.hand.length === 0)
  const isLandlordWin = winner?.role === 'landlord'
  const roundScore = state.baseScore * state.multiplier

  // 按累计积分排序
  const ranked = [...state.players].sort((a, b) => (scoreMap[b.id] || 0) - (scoreMap[a.id] || 0))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-surface-container-low rounded-2xl p-8 max-w-lg w-full mx-4 shadow-2xl space-y-6">
        {/* 标题 */}
        <div className="text-center">
          <div className="text-4xl mb-2">{isLandlordWin ? '👑' : '🌾'}</div>
          <h2 className="text-2xl font-black font-headline text-on-surface">
            {isLandlordWin ? '地主胜!' : '农民胜!'}
          </h2>
          <p className="text-sm text-on-surface-variant mt-1">
            第 {state.roundNumber} 局 · 底分 {state.baseScore} × {state.multiplier}倍 = {roundScore} 分
          </p>
        </div>

        {/* 积分表 */}
        <div className="bg-surface-container rounded-xl overflow-hidden">
          {/* 表头 */}
          <div className="grid grid-cols-4 gap-2 px-4 py-2.5 bg-surface-container-high/50 text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
            <span>排名</span>
            <span>玩家</span>
            <span className="text-right">本局</span>
            <span className="text-right">累计</span>
          </div>
          {/* 每个玩家 */}
          {ranked.map((p, i) => {
            const delta = p.role === 'landlord'
              ? (isLandlordWin ? roundScore * 2 : -roundScore * 2)
              : (isLandlordWin ? -roundScore : roundScore)
            const total = scoreMap[p.id] || 0
            const isTop = i === 0
            return (
              <div key={p.id} className={`grid grid-cols-4 gap-2 px-4 py-3 items-center border-t border-outline-variant/5 ${isTop ? 'bg-primary/5' : ''}`}>
                {/* 排名 */}
                <span className="text-sm font-black text-on-surface-variant">
                  {i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'}
                </span>
                {/* 名字 + 角色 */}
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm text-on-surface">{p.name}</span>
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                    p.role === 'landlord' ? 'bg-error/15 text-error' : 'bg-primary/15 text-primary'
                  }`}>
                    {p.role === 'landlord' ? '地主' : '农民'}
                  </span>
                </div>
                {/* 本局 delta */}
                <span className={`text-right text-sm font-headline font-black ${delta > 0 ? 'text-primary' : 'text-error'}`}>
                  {delta > 0 ? '+' : ''}{delta}
                </span>
                {/* 累计 */}
                <span className={`text-right text-sm font-headline font-black ${total > 0 ? 'text-primary' : total < 0 ? 'text-error' : 'text-on-surface-variant'}`}>
                  {total > 0 ? '+' : ''}{total}
                </span>
              </div>
            )
          })}
        </div>

        {/* 历史积分走势 (简洁文字版) */}
        {scoreHistory.length > 1 && (
          <div className="bg-surface-container rounded-xl px-4 py-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-2">历史积分</div>
            <div className="flex gap-3 overflow-x-auto pb-1">
              {scoreHistory.map((entry, i) => (
                <div key={i} className="shrink-0 text-center">
                  <div className="text-[9px] text-on-surface-variant/50 mb-1">第{entry.round}局</div>
                  {state.players.map(p => {
                    const d = entry.scores[p.id] || 0
                    return (
                      <div key={p.id} className={`text-[10px] font-bold ${d > 0 ? 'text-primary/70' : d < 0 ? 'text-error/70' : 'text-on-surface-variant/30'}`}>
                        {d > 0 ? '+' : ''}{d}
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 操作 */}
        <div className="flex gap-3">
          <button onClick={onNewRound} className="flex-1 py-3 bg-primary text-on-primary font-bold rounded-xl hover:bg-primary-container transition-all active:scale-95">
            再来一局
          </button>
          <button onClick={onExit} className="flex-1 py-3 bg-surface-container text-on-surface-variant font-bold rounded-xl hover:bg-surface-container-high transition-all active:scale-95">
            退出
          </button>
          <button onClick={onDismiss} className="py-3 px-4 text-on-surface-variant hover:text-on-surface transition-colors">
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}
