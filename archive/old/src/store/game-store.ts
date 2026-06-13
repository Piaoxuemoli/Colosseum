import { create } from 'zustand'
import type { GameState } from '../types/game'
import type { ActionType } from '../types/action'
import type { HandHistory } from '../types/history'
import type { StructuredImpression } from '../types/player'
import { GameEngine } from '../games/poker/engine/poker-engine'
import type { GameConfig, AvailableAction } from '../games/poker/engine/poker-engine'
import { BotAdapter, LLMAdapter, HumanAdapter } from '../agent/player-adapter'
import type { DecisionResult } from '../agent/player-adapter'
import type { APIProfile } from '../agent/llm-client'
import { saveHistory } from '../db/history-service'
import { saveGameSnapshot, deleteGameSnapshot } from '../db/snapshot-service'
import type { GameSnapshotRecord } from '../db/database'
import { requestImpressionUpdate, applyImpressions } from '../games/poker/agent/poker-impressions'
import { calculateMultiPlayerEquity } from '../games/poker/engine/equity'
import type { PlayerEquity } from '../games/poker/engine/equity'
import { logState, snapshotPlayers, cardsStr } from '../debug/state-logger'
import { getGame } from '../core/registry/game-registry'
import type { GamePlugin } from '../core/protocols'
import { Gateway } from '../core/gateway/gateway'
import type { LLMClient, LLMClientFactory } from '../core/gateway/gateway'
import { callLLMStreaming } from '../agent/llm-client'
import { useAppStore } from './app-store'

/** Per-LLM player impression map: playerId → { targetId → StructuredImpression } */
export type ImpressionsMap = Record<string, Record<string, StructuredImpression>>

/** Individual impression history entry for tracking changes across hands */
export interface ImpressionHistoryEntry {
  handNumber: number
  playerId: string
  targetId: string
  impression: StructuredImpression
}

/** Module-level action processing lock to prevent concurrent processNextAction calls */
let isProcessingAction = false
/** Timestamp of last player action to prevent double-clicks */
let lastPlayerActionTime = 0
/** Hand number when current processNextAction started — used to detect stale continuations */
/** In-flight LLM decision keys to prevent duplicate prompts: "hand#-playerId" */
const pendingDecisions = new Set<string>()

interface GameStore {
  // Game type & plugin
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  gameType: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  plugin: GamePlugin<any, any, any> | null

  // State
  engine: GameEngine | null
  gameState: GameState | null
  isRunning: boolean
  availableActions: AvailableAction[]
  statusText: string
  tipMessage: string | null
  tipVisible: boolean
  lastHandHistory: HandHistory | null

  // Bot/LLM animation state
  thinkingBotId: string | null
  thinkingContent: string | null
  thinkingStartTime: number | null
  lastBotAction: { playerId: string; action: { type: ActionType; amount?: number } } | null
  isBotActing: boolean
  phaseJustChanged: string | null
  llmThoughts: Record<string, string>  // playerId -> thinking content

  // Thinking chain — all LLM thoughts in order for right panel
  thinkingChain: { playerId: string; playerName: string; content: string }[]

  // AI Competition mode
  autoPlay: boolean
  autoPlayHandCount: number

  // Real-time equity (spectator view)
  playerEquities: PlayerEquity[]

  // Impressions (reactive, per-session)
  impressions: ImpressionsMap
  impressionHistory: ImpressionHistoryEntry[]

  // End game ranking
  showRanking: boolean
  initialChipsMap: Record<string, number>

  // Live leaderboard tracking (spectator view)
  prevHandRanks: Record<string, number>    // playerId → rank (1-based) from previous hand
  firstPlaceStreak: number                  // consecutive hands the current #1 has been first
  firstPlacePlayerId: string | null         // who is the current streak holder

  // Adapters
  humanAdapter: HumanAdapter | null
  botAdapter: BotAdapter | null
  llmAdapter: LLMAdapter | null

  // Gateway (乐高化事务管控器，与 adapters 并存，逐步替代)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  gateway: Gateway<any, any> | null

  // Actions
  initGame: (config: GameConfig, getProfile: (id: string) => APIProfile | undefined) => void
  restoreGame: (getProfile: (id: string) => APIProfile | undefined) => Promise<boolean>
  startNewHand: () => void
  playerAction: (type: ActionType, amount?: number) => void
  resetGame: () => void
  endGame: () => void
  dismissRanking: () => void
  setAutoPlay: (auto: boolean) => void
  computeEquity: () => void
  showTip: (msg: string) => void
  dismissTip: () => void

  // Internal helpers
  syncState: () => void
  setThinkingBotId: (id: string | null) => void
  setThinkingContent: (content: string | null) => void
  setLastBotAction: (playerId: string, action: { type: ActionType; amount?: number }) => void
  clearLastBotAction: () => void
  setIsBotActing: (acting: boolean) => void
  setPhaseJustChanged: (phase: string | null) => void

  // Async action processing
  processNextAction: () => Promise<void>
  triggerImpressionUpdates: () => Promise<void>
  loadCrossSessionImpressions: () => Promise<void>
}

export const useGameStore = create<GameStore>((set, get) => ({
  gameType: 'poker',
  plugin: null,

  engine: null,
  gameState: null,
  isRunning: false,
  availableActions: [],
  statusText: '欢迎来到 LLM Poker Arena！配置好座位后点击"开始游戏"。',
  tipMessage: null,
  tipVisible: false,
  lastHandHistory: null,

  thinkingBotId: null,
  thinkingContent: null,
  thinkingStartTime: null,
  lastBotAction: null,
  isBotActing: false,
  phaseJustChanged: null,
  llmThoughts: {},
  thinkingChain: [],

  autoPlay: false,
  autoPlayHandCount: 0,

  playerEquities: [],

  impressions: {},
  impressionHistory: [],

  showRanking: false,
  initialChipsMap: {},

  prevHandRanks: {},
  firstPlaceStreak: 0,
  firstPlacePlayerId: null,

  humanAdapter: null,
  botAdapter: null,
  llmAdapter: null,
  gateway: null,

  initGame: (config: GameConfig, getProfile: (id: string) => APIProfile | undefined) => {
    // Load plugin from Registry — 从 app-store 读取当前游戏类型
    const gameType = useAppStore.getState().activeGameType || 'poker'
    let plugin: GamePlugin<any, any, any> | null = null
    try {
      plugin = getGame(gameType)
    } catch {
      // Registry not initialized yet, proceed without plugin
    }

    const engine = new GameEngine(config)
    const humanAdapter = new HumanAdapter()
    const botAdapter = new BotAdapter(engine.getBotAI())

    const onThinkingUpdate = (playerId: string, content: string) => {
      // Only accept thinking updates for the player currently thinking
      // This prevents stale/delayed streaming chunks from polluting state
      const currentThinkingId = get().thinkingBotId
      if (currentThinkingId !== playerId) return
      set(prev => ({
        llmThoughts: { ...prev.llmThoughts, [playerId]: content },
      }))
    }
    const llmAdapter = new LLMAdapter(getProfile, config.timingConfig?.thinkingTimeout, onThinkingUpdate)

    // 创建 Gateway（乐高化事务管控器）
    // LLMClientFactory: 根据 playerId 找到对应 APIProfile，返回 LLMClient
    let gateway: Gateway<any, any> | null = null
    if (plugin) {
      const timeoutMs = config.timingConfig?.thinkingTimeout ?? 30000
      const llmClientFactory: LLMClientFactory = (playerId: string) => {
        // 从引擎状态找到该玩家的 profileId
        const state = engine.getState()
        const player = state.players.find((p: { id: string }) => p.id === playerId)
        if (!player?.profileId) return null
        const profile = getProfile(player.profileId)
        if (!profile) return null

        // 将 callLLMStreaming 包装为 LLMClient 接口
        const client: LLMClient = {
          async chat(messages, options) {
            const onChunk: (delta: string, fullText: string) => void = options?.onChunk
              ? (_delta: string, fullText: string) => {
                  // 提取 <thinking> 内容
                  const match = fullText.match(/<thinking>([\s\S]*?)(?:<\/thinking>|$)/)
                  if (match) options.onChunk!(match[1].trim())
                }
              : () => {}
            const content = await callLLMStreaming(
              profile,
              messages as import('../agent/llm-client').ChatMessage[],
              onChunk,
              timeoutMs,
              options?.signal,
            )
            // 提取 thinking 和 raw content
            const thinkMatch = content.match(/<thinking>([\s\S]*?)<\/thinking>/)
            return {
              content,
              thinking: thinkMatch ? thinkMatch[1].trim() : undefined,
            }
          },
        }
        return client
      }

      gateway = new Gateway({
        engine: plugin.createEngine(),
        contextBuilder: plugin.contextBuilder,
        responseParser: plugin.responseParser,
        botStrategy: plugin.botStrategy,
        llmClientFactory,
        maxRetries: 1,
      })
    }

    // Store initial chips for ranking panel
    const initialChipsMap: Record<string, number> = {}
    for (const p of engine.getState().players) {
      initialChipsMap[p.id] = p.chips
    }

    set({
      engine,
      plugin,
      gameType,
      gameState: engine.getState(),
      isRunning: true,
      statusText: '游戏已创建，等待发牌。',
      tipMessage: '游戏已创建，点击"发牌"开始第一手',
      tipVisible: true,
      availableActions: [],
      humanAdapter,
      botAdapter,
      llmAdapter,
      gateway,
      llmThoughts: {},
      thinkingChain: [],
      impressions: {},
      impressionHistory: [],
      showRanking: false,
      initialChipsMap,
      prevHandRanks: {},
      firstPlaceStreak: 0,
      firstPlacePlayerId: null,
    })

    // Load cross-session impressions in background
    get().loadCrossSessionImpressions()
  },

  restoreGame: async (getProfile: (id: string) => APIProfile | undefined) => {
    const { loadLatestSnapshot } = await import('../db/snapshot-service')
    const snapshot = await loadLatestSnapshot()
    if (!snapshot) return false

    const engine = GameEngine.restore(snapshot.engineData)
    const humanAdapter = new HumanAdapter()
    const botAdapter = new BotAdapter(engine.getBotAI())

    const onThinkingUpdate = (playerId: string, content: string) => {
      const currentThinkingId = get().thinkingBotId
      if (currentThinkingId !== playerId) return
      set(prev => ({
        llmThoughts: { ...prev.llmThoughts, [playerId]: content },
      }))
    }
    const llmAdapter = new LLMAdapter(
      getProfile,
      snapshot.gameConfig.thinkingTimeout,
      onThinkingUpdate,
    )

    // 重置模块级锁
    isProcessingAction = false
    pendingDecisions.clear()

    set({
      engine,
      humanAdapter,
      botAdapter,
      llmAdapter,
      gameState: engine.getState(),
      isRunning: true,
      autoPlay: snapshot.storeState.autoPlay,
      autoPlayHandCount: snapshot.storeState.autoPlayHandCount,
      impressions: snapshot.storeState.impressions,
      impressionHistory: snapshot.storeState.impressionHistory,
      initialChipsMap: snapshot.storeState.initialChipsMap,
      prevHandRanks: snapshot.storeState.prevHandRanks,
      firstPlaceStreak: snapshot.storeState.firstPlaceStreak,
      firstPlacePlayerId: snapshot.storeState.firstPlacePlayerId,
      llmThoughts: snapshot.storeState.llmThoughts,
      thinkingChain: snapshot.storeState.thinkingChain,
      // 清空瞬态 UI 状态
      thinkingBotId: null,
      thinkingContent: null,
      thinkingStartTime: null,
      lastBotAction: null,
      isBotActing: false,
      showRanking: false,
      availableActions: [],
      statusText: `对局已恢复 — 第 ${engine.getState().handNumber} 手`,
      tipMessage: '对局已恢复，点击"发牌"继续下一手',
      tipVisible: true,
      lastHandHistory: null,
      phaseJustChanged: null,
      playerEquities: [],
    })

    get().syncState()
    return true
  },

  setAutoPlay: (auto: boolean) => set({ autoPlay: auto }),

  showTip: (msg: string) => set({ tipMessage: msg, tipVisible: true }),
  dismissTip: () => set({ tipVisible: false }),

  computeEquity: () => {
    const { engine } = get()
    if (!engine) return

    const state = engine.getState()
    if (state.phase === 'waiting' || state.phase === 'showdown') {
      set({ playerEquities: [] })
      return
    }

    // Only compute for players still in the hand
    const activePlayers = state.players.filter(
      p => (p.status === 'active' || p.status === 'allIn') && p.holeCards.length === 2
    )

    if (activePlayers.length < 2) {
      set({ playerEquities: activePlayers.map(p => ({ playerId: p.id, equity: 1 })) })
      return
    }

    // Use fewer simulations for real-time (performance)
    const sims = state.communityCards.length >= 4 ? 3000 : 1500
    const equities = calculateMultiPlayerEquity(
      activePlayers.map(p => ({ playerId: p.id, holeCards: p.holeCards })),
      state.communityCards,
      sims,
    )
    set({ playerEquities: equities })
  },

  startNewHand: () => {
    const { engine, autoPlay } = get()
    if (!engine) return

    // Check game-over: only 1 non-eliminated player with chips > 0
    const state = engine.getState()
    const playersWithChips = state.players.filter(p => p.chips > 0 && p.status !== 'eliminated')
    if (playersWithChips.length <= 1) {
      const winner = playersWithChips[0]
      const gameOverMsg = winner
        ? `🏆 游戏结束！${winner.name} 赢得全部筹码！`
        : '游戏结束！'
      set({
        autoPlay: false,
        showRanking: true,
        statusText: gameOverMsg,
        tipMessage: gameOverMsg,
        tipVisible: true,
      })
      return
    }

    // === Compute ranking snapshot from CURRENT chips (before new hand starts) ===
    const sortedByChips = [...state.players]
      .sort((a, b) => b.chips - a.chips)
    const newPrevRanks: Record<string, number> = {}
    sortedByChips.forEach((p, i) => { newPrevRanks[p.id] = i + 1 })

    // Track first-place streak
    const currentFirstId = sortedByChips[0]?.id || null
    let newStreak = get().firstPlaceStreak
    let newStreakPlayerId = get().firstPlacePlayerId
    if (currentFirstId && currentFirstId === newStreakPlayerId) {
      newStreak++
    } else {
      newStreak = 1
      newStreakPlayerId = currentFirstId
    }

    engine.startNewHand()

    const newState = engine.getState()
    const currentPlayer = newState.players.find(p => p.seatIndex === newState.currentPlayerIndex)
    const needAutoAction = currentPlayer && currentPlayer.type !== 'human'

    // === DEBUG LOG: NEW_HAND ===
    logState({
      event: 'NEW_HAND',
      handNumber: newState.handNumber,
      phase: newState.phase,
      pot: newState.pot,
      communityCards: cardsStr(newState.communityCards),
      players: snapshotPlayers(newState),
      detail: `dealer=seat${newState.dealerIndex} current=seat${newState.currentPlayerIndex} isProcessingAction=${isProcessingAction}`,
    })

    set({
      gameState: newState,
      availableActions: needAutoAction ? [] : engine.getAvailableActions(),
      statusText: autoPlay
        ? `AI 竞技中 — 第 ${newState.handNumber} 手`
        : `第 ${newState.handNumber} 手 — 翻前`,
      tipMessage: null,
      tipVisible: false,
      lastHandHistory: null,
      isBotActing: needAutoAction || false,
      phaseJustChanged: 'preflop',
      llmThoughts: {},
      thinkingChain: [],
      autoPlayHandCount: autoPlay ? get().autoPlayHandCount + 1 : 0,
      prevHandRanks: newPrevRanks,
      firstPlaceStreak: newStreak,
      firstPlacePlayerId: newStreakPlayerId,
    })

    setTimeout(() => {
      set({ phaseJustChanged: null })
    }, 1500)

    // Non-human actions are triggered by useActionQueue reacting to isBotActing: true
    // Do NOT call processNextAction() directly here — it causes double-fire race condition
  },

  playerAction: (type: ActionType, amount?: number) => {
    // Prevent double-click actions within 200ms
    const now = Date.now()
    if (now - lastPlayerActionTime < 200) return
    lastPlayerActionTime = now

    const { engine, humanAdapter } = get()
    if (!engine) return

    // If human adapter is waiting, resolve it
    if (humanAdapter && humanAdapter.isWaiting()) {
      humanAdapter.resolveAction(type, amount)
      return
    }

    // Direct execution (fallback)
    engine.executeAction({ type, amount })

    const state = engine.getState()
    const phaseNames: Record<string, string> = {
      preflop: '翻前', flop: '翻牌', turn: '转牌', river: '河牌', showdown: '摊牌',
    }
    let statusText = `第 ${state.handNumber} 手 — ${phaseNames[state.phase] || state.phase}`

    let lastHandHistory = null
    let tipMessage: string | null = null
    if (state.phase === 'showdown') {
      const histories = engine.getHandHistories()
      lastHandHistory = histories[histories.length - 1] || null
      if (lastHandHistory) {
        const winnerNames = lastHandHistory.winners.map(w => {
          const player = state.players.find(p => p.id === w.playerId)
          return `${player?.name || w.playerId} (${w.handRank}, +$${w.amount})`
        })
        statusText += ` — 赢家: ${winnerNames.join(', ')}`
        tipMessage = `赢家: ${winnerNames.join(', ')}`
        saveHistory(lastHandHistory).catch(console.error)
      }
    }

    const currentPlayer = state.players.find(p => p.seatIndex === state.currentPlayerIndex)
    const needAutoAction = state.phase !== 'showdown' && state.phase !== 'waiting' &&
      currentPlayer && currentPlayer.type !== 'human'

    set({
      gameState: state,
      availableActions: needAutoAction ? [] : (state.phase !== 'showdown' ? engine.getAvailableActions() : []),
      statusText,
      ...(tipMessage ? { tipMessage, tipVisible: true } : {}),
      lastHandHistory,
      isBotActing: needAutoAction || false,
    })
    // isBotActing change triggers useActionQueue → processNextAction
  },

  processNextAction: async () => {
    // Prevent concurrent action processing from external triggers
    if (isProcessingAction) return
    isProcessingAction = true

    try {
    const { engine, botAdapter, llmAdapter, humanAdapter, gateway } = get()
    if (!engine) return

    const state = engine.getState()
    const myHandNumber = state.handNumber

    /** Check if a new hand has started while we were awaiting */
    const isStale = () => engine.getState().handNumber !== myHandNumber

    if (state.phase === 'showdown' || state.phase === 'waiting') {
      set({ isBotActing: false })
      get().syncState()
      return
    }

    const currentPlayer = state.players.find(p => p.seatIndex === state.currentPlayerIndex)
    if (!currentPlayer || currentPlayer.status !== 'active') {
      set({ isBotActing: false })
      get().syncState()
      return
    }

    // Human player — wait for UI
    if (currentPlayer.type === 'human') {
      set({
        isBotActing: false,
        availableActions: engine.getAvailableActions(),
      })

      if (humanAdapter) {
        const validActions = engine.getAvailableActions()
        const decision = await humanAdapter.decide(currentPlayer, state, validActions)
        if (isStale()) return // Hand changed while waiting for human

        engine.executeAction({ type: decision.type, amount: decision.amount })

        get().syncState()

        // Schedule next action if needed (non-human)
        const newState = engine.getState()
        const nextPlayer = newState.players.find(p => p.seatIndex === newState.currentPlayerIndex)
        if (nextPlayer && nextPlayer.type !== 'human' &&
            newState.phase !== 'showdown' && newState.phase !== 'waiting') {
          set({ isBotActing: true })
          // isBotActing change triggers useActionQueue → processNextAction
        }
      }
      return
    }

    // --- Bot / LLM player ---

    // Duplicate-prompt guard: same hand + same player = skip
    const decisionKey = `${myHandNumber}-${currentPlayer.id}`
    if (pendingDecisions.has(decisionKey)) {
      logState({ event: 'DUPLICATE_BLOCKED', handNumber: myHandNumber, phase: state.phase, playerName: currentPlayer.name, detail: `key ${decisionKey} already in-flight` })
      return
    }
    pendingDecisions.add(decisionKey)

    // Show thinking state
    set({ thinkingBotId: currentPlayer.id, thinkingContent: null, thinkingStartTime: Date.now() })

    let decision: DecisionResult

    try {
      const validActions = engine.getAvailableActions()

      // === DEBUG LOG: LLM_PROMPT ===
      const storeGs = get().gameState
      logState({
        event: 'LLM_PROMPT',
        handNumber: myHandNumber,
        phase: state.phase,
        playerId: currentPlayer.id,
        playerName: currentPlayer.name,
        holeCards: cardsStr(currentPlayer.holeCards),
        communityCards: cardsStr(state.communityCards),
        pot: state.pot,
        chips: currentPlayer.chips,
        validActions: validActions.map(a => a.type + (a.minAmount ? `($${a.minAmount})` : '')).join(', '),
        storeHandNumber: storeGs?.handNumber,
        storePhase: storeGs?.phase,
        storePot: storeGs?.pot,
        players: snapshotPlayers(state),
      })

      if (gateway && (currentPlayer.type === 'bot' || currentPlayer.type === 'llm')) {
        // ── 乐高化路径: 走 Gateway 事务 ──
        const timeoutMs = state.timingConfig.thinkingTimeout
        const globalController = new AbortController()
        let globalTimeoutId: ReturnType<typeof setTimeout> | null = null
        if (timeoutMs > 0) {
          globalTimeoutId = setTimeout(() => globalController.abort('LLM total timeout'), timeoutMs)
        }

        try {
          // 构造 personality（名字 + 自定义提示词）
          const personality = {
            name: currentPlayer.name,
            systemPrompt: currentPlayer.systemPrompt,
          }
          // 构造印象数据（从引擎 player 的 Map 转为 Record）
          const impressionsRecord: Record<string, Record<string, number>> = {}
          if (currentPlayer.impressions) {
            for (const [targetId, imp] of currentPlayer.impressions.entries()) {
              impressionsRecord[targetId] = {
                looseness: imp.looseness,
                aggression: imp.aggression,
                stickiness: imp.stickiness,
                honesty: imp.honesty,
              }
            }
          }

          const result = await gateway.requestAgentAction(state, currentPlayer.id, {
            personality,
            impressions: impressionsRecord,
            signal: globalController.signal,
            timeout: timeoutMs,
            onChunk: (thinkingContent: string) => {
              // 流式思考内容更新
              const currentThinkingId = get().thinkingBotId
              if (currentThinkingId !== currentPlayer.id) return
              set(prev => ({
                llmThoughts: { ...prev.llmThoughts, [currentPlayer.id]: thinkingContent },
              }))
            },
          })

          decision = {
            type: result.action.type as ActionType,
            amount: (result.action as { amount?: number }).amount ?? 0,
            thinking: result.thinking,
            error: result.source === 'bot' && currentPlayer.type === 'llm' ? 'Gateway fallback to bot' : undefined,
          }
        } finally {
          if (globalTimeoutId) clearTimeout(globalTimeoutId)
        }
      } else if (currentPlayer.type === 'bot' && botAdapter) {
        // ── 旧路径 fallback（无 gateway 时） ──
        decision = await botAdapter.decide(currentPlayer, state, validActions)
      } else if (currentPlayer.type === 'llm' && llmAdapter) {
        // ── 旧路径 fallback（无 gateway 时） ──
        decision = await llmAdapter.decide(currentPlayer, state, validActions)
      } else {
        decision = { type: 'fold', amount: 0 }
      }
    } catch (err) {
      const partialThinking = get().llmThoughts[currentPlayer.id] || undefined
      const errMsg = err instanceof Error ? err.message : String(err)
      decision = { type: 'fold', amount: 0, thinking: partialThinking }
      get().showTip(`⚠ ${currentPlayer.name} 出错，自动弃牌: ${errMsg}`)
    }

    // Clear pending decision key now that LLM call is done
    pendingDecisions.delete(decisionKey)

    // Stale check: if hand changed during LLM call, discard result
    if (isStale()) {
      logState({ event: 'STALE_ABORT', handNumber: myHandNumber, phase: state.phase, playerName: currentPlayer.name, detail: `after LLM decide, engine now hand#${engine.getState().handNumber}` })
      set({ thinkingBotId: null, thinkingContent: null, thinkingStartTime: null })
      return
    }

    // === DEBUG LOG: LLM_DECISION ===
    logState({
      event: 'LLM_DECISION',
      handNumber: myHandNumber,
      phase: state.phase,
      playerId: currentPlayer.id,
      playerName: currentPlayer.name,
      decision: decision.type,
      decisionAmount: decision.amount,
      thinkingSnippet: decision.thinking?.slice(0, 80),
      detail: decision.error ? `error: ${decision.error}` : undefined,
    })

    // If adapter returned an error (e.g. network failure), show it as tip
    if (decision.error) {
      const reason = decision.error.includes('Failed to fetch')
        ? '网络连接失败，请检查 API 地址和网络'
        : decision.error.includes('timeout')
          ? '思考超时'
          : decision.error
      get().showTip(`⚠ ${currentPlayer.name} ${reason}，自动弃牌`)
    }

    // Record thinking — always write to thinkingChain so the user sees decision rationale.
    // For errors: synthesize a thinking entry with the error reason.
    const thinkingToRecord = decision.error
      ? `${decision.thinking ? decision.thinking + '\n\n' : ''}⚠ ${decision.error}`
      : decision.thinking
    if (thinkingToRecord) {
      engine.recordThinking(currentPlayer.id, thinkingToRecord)
      set(prev => ({
        llmThoughts: { ...prev.llmThoughts, [currentPlayer.id]: thinkingToRecord },
        thinkingContent: thinkingToRecord,
        thinkingChain: [...prev.thinkingChain, { playerId: currentPlayer.id, playerName: currentPlayer.name, content: thinkingToRecord }],
      }))
    }

    // Wait for display time AFTER LLM returns (not in parallel)
    // thinkingTimeout === 0 (unlimited): thinking is fully loaded, execute immediately
    // error: skip delay
    // LLM with thinking: use minActionInterval so user has a moment to see the action
    // Bot/no thinking: normal interval
    const isUnlimitedTime = state.timingConfig.thinkingTimeout === 0
    const displayDelay = (decision.error || isUnlimitedTime) ? 0
      : (currentPlayer.type === 'llm' && decision.thinking) ? 8000
      : state.timingConfig.minActionInterval
    await new Promise(resolve => setTimeout(resolve, displayDelay))

    // Stale check: if hand changed during display delay, discard
    if (isStale()) {
      logState({ event: 'STALE_ABORT', handNumber: myHandNumber, phase: state.phase, playerName: currentPlayer.name, detail: `after display delay, engine now hand#${engine.getState().handNumber}` })
      set({ thinkingBotId: null, thinkingContent: null, thinkingStartTime: null, lastBotAction: null })
      return
    }

    // Execute the action
    engine.executeAction({ type: decision.type, amount: decision.amount })

    // === DEBUG LOG: ACTION_EXEC ===
    const postExecState = engine.getState()
    logState({
      event: 'ACTION_EXEC',
      handNumber: myHandNumber,
      phase: postExecState.phase,
      playerId: currentPlayer.id,
      playerName: currentPlayer.name,
      decision: decision.type,
      decisionAmount: decision.amount,
      pot: postExecState.pot,
      communityCards: cardsStr(postExecState.communityCards),
      players: snapshotPlayers(postExecState),
      detail: postExecState.phase !== state.phase ? `PHASE_CHANGE ${state.phase}→${postExecState.phase}` : undefined,
    })

    // Show action briefly
    set({
      lastBotAction: { playerId: currentPlayer.id, action: { type: decision.type, amount: decision.amount } },
      thinkingBotId: null,
      thinkingContent: null,
      thinkingStartTime: null,
    })

    get().syncState()

    // Brief pause after action
    await new Promise(resolve => setTimeout(resolve, 600))
    if (isStale()) { set({ lastBotAction: null }); return }
    set({ lastBotAction: null })

    // Continue to next action
    const newState = engine.getState()
    if (newState.phase !== 'showdown' && newState.phase !== 'waiting') {
      const nextPlayer = newState.players.find(p => p.seatIndex === newState.currentPlayerIndex)
      if (nextPlayer && nextPlayer.type === 'human') {
        set({ isBotActing: false })
      }
      // For non-human next player: keep isBotActing true.
      // Lock released in finally → useActionQueue re-triggers via nudge below.
    } else {
      set({ isBotActing: false })
      // Hand ended — trigger impression updates in background
      if (newState.phase === 'showdown') {
        // === DEBUG LOG: SHOWDOWN ===
        logState({
          event: 'SHOWDOWN',
          handNumber: myHandNumber,
          phase: 'showdown',
          pot: newState.pot,
          communityCards: cardsStr(newState.communityCards),
          players: snapshotPlayers(newState),
        })
        get().triggerImpressionUpdates()

        // AutoPlay: wait 2s then start next hand
        if (get().autoPlay) {
          await new Promise(resolve => setTimeout(resolve, 2000))
          if (get().autoPlay) { // Check again in case user stopped
            get().startNewHand()
            // startNewHand sets isBotActing:true → useActionQueue triggers processNextAction
          }
        }
      }
    }
    } finally {
      isProcessingAction = false
      // If more actions needed (isBotActing still true), nudge useActionQueue.
      // Toggle isBotActing off→on so React useEffect re-fires after lock is released.
      if (get().isBotActing) {
        const eng = get().engine
        if (eng) {
          const s = eng.getState()
          if (s.phase !== 'showdown' && s.phase !== 'waiting') {
            set({ isBotActing: false })
            queueMicrotask(() => {
              if (!isProcessingAction) {
                set({ isBotActing: true })
              }
            })
          }
        }
      }
    }
  },

  syncState: () => {
    const { engine } = get()
    if (!engine) return

    const state = engine.getState()

    // === DEBUG LOG: SYNC_STATE ===
    const prevGs = get().gameState
    if (prevGs && (prevGs.handNumber !== state.handNumber || prevGs.phase !== state.phase)) {
      logState({
        event: 'SYNC_STATE',
        handNumber: state.handNumber,
        phase: state.phase,
        pot: state.pot,
        communityCards: cardsStr(state.communityCards),
        storeHandNumber: prevGs.handNumber,
        storePhase: prevGs.phase,
        storePot: prevGs.pot,
        detail: prevGs.handNumber !== state.handNumber ? `HAND NUMBER CHANGED ${prevGs.handNumber}→${state.handNumber}` : `PHASE CHANGED ${prevGs.phase}→${state.phase}`,
      })
    }

    const actions = state.phase !== 'showdown' ? engine.getAvailableActions() : []

    const phaseNames: Record<string, string> = {
      preflop: '翻前', flop: '翻牌', turn: '转牌', river: '河牌', showdown: '摊牌',
    }
    let statusText = `第 ${state.handNumber} 手 — ${phaseNames[state.phase] || state.phase}`

    let lastHandHistory = null
    let tipMessage: string | null = null
    if (state.phase === 'showdown') {
      const histories = engine.getHandHistories()
      lastHandHistory = histories[histories.length - 1] || null
      if (lastHandHistory) {
        const winnerNames = lastHandHistory.winners.map(w => {
          const player = state.players.find(p => p.id === w.playerId)
          return `${player?.name || w.playerId} (${w.handRank}, +$${w.amount})`
        })
        statusText += ` — 赢家: ${winnerNames.join(', ')}`
        tipMessage = `赢家: ${winnerNames.join(', ')}`
        saveHistory(lastHandHistory).catch(console.error)
      }
    }

    // Phase changed → clear stale thinking content so bubbles don't show old-phase analysis
    const phaseChanged = prevGs && prevGs.phase !== state.phase
    const clearThoughts = phaseChanged ? { llmThoughts: {} } : {}

    set({
      gameState: state,
      availableActions: actions,
      statusText,
      ...(tipMessage ? { tipMessage, tipVisible: true } : {}),
      lastHandHistory,
      ...clearThoughts,
    })

    // Showdown 时保存快照到 IndexedDB（用于断线重连）
    if (state.phase === 'showdown' && engine) {
      const storeState = get()
      const snapshot: GameSnapshotRecord = {
        sessionId: state.sessionId,
        timestamp: Date.now(),
        version: 1,
        engineData: engine.serialize(),
        gameConfig: {
          smallBlind: state.smallBlind,
          bigBlind: state.bigBlind,
          minActionInterval: state.timingConfig.minActionInterval,
          thinkingTimeout: state.timingConfig.thinkingTimeout,
        },
        storeState: {
          autoPlay: storeState.autoPlay,
          autoPlayHandCount: storeState.autoPlayHandCount,
          impressions: storeState.impressions,
          impressionHistory: storeState.impressionHistory,
          initialChipsMap: storeState.initialChipsMap,
          prevHandRanks: storeState.prevHandRanks,
          firstPlaceStreak: storeState.firstPlaceStreak,
          firstPlacePlayerId: storeState.firstPlacePlayerId,
          llmThoughts: storeState.llmThoughts,
          thinkingChain: storeState.thinkingChain,
        },
      }
      saveGameSnapshot(snapshot).catch(console.error)
    }

    // Compute equity after state sync (non-blocking)
    setTimeout(() => get().computeEquity(), 0)
  },

  setThinkingBotId: (id: string | null) => set({ thinkingBotId: id }),
  setThinkingContent: (content: string | null) => set({ thinkingContent: content }),

  setLastBotAction: (playerId: string, action: { type: ActionType; amount?: number }) =>
    set({ lastBotAction: { playerId, action } }),
  clearLastBotAction: () => set({ lastBotAction: null }),
  setIsBotActing: (acting: boolean) => set({ isBotActing: acting }),
  setPhaseJustChanged: (phase: string | null) => set({ phaseJustChanged: phase }),

  resetGame: () => {
    // 删除快照
    const gs = get().gameState
    if (gs?.sessionId) {
      deleteGameSnapshot(gs.sessionId).catch(console.error)
    }
    set({
      engine: null,
      plugin: null,
      gameState: null,
      isRunning: false,
      availableActions: [],
      statusText: '欢迎来到 LLM Poker Arena！配置好座位后点击"开始游戏"。',
      tipMessage: null,
      tipVisible: false,
      lastHandHistory: null,
      thinkingBotId: null,
      thinkingContent: null,
      thinkingStartTime: null,
      lastBotAction: null,
      isBotActing: false,
      phaseJustChanged: null,
      llmThoughts: {},
      thinkingChain: [],
      autoPlay: false,
      autoPlayHandCount: 0,
      playerEquities: [],
      impressions: {},
      impressionHistory: [],
      showRanking: false,
      initialChipsMap: {},
      prevHandRanks: {},
      firstPlaceStreak: 0,
      firstPlacePlayerId: null,
      humanAdapter: null,
      botAdapter: null,
      llmAdapter: null,
      gateway: null,
    })
  },

  endGame: () => {
    // 删除快照 + 停止 autoplay + 显示排名
    const gs = get().gameState
    if (gs?.sessionId) {
      deleteGameSnapshot(gs.sessionId).catch(console.error)
    }
    set({ autoPlay: false, showRanking: true })
  },

  dismissRanking: () => {
    set({ showRanking: false })
  },

  triggerImpressionUpdates: async () => {
    const { engine } = get()
    if (!engine) return

    const state = engine.getState()
    const handNumber = state.handNumber
    const llmPlayers = state.players.filter(p => p.type === 'llm' && p.profileId)

    const newImpressions: ImpressionsMap = { ...get().impressions }
    const newHistoryEntries: ImpressionHistoryEntry[] = []

    for (const player of llmPlayers) {
      const profileStore = await import('./profile-store')
      const profile = profileStore.useProfileStore.getState().getProfile(player.profileId!)
      if (!profile) continue

      const updates = await requestImpressionUpdate(
        profile,
        player,
        state,
        player.impressions,
        state.timingConfig.thinkingTimeout,
      )

      if (updates) {
        // Apply to engine player (in-memory for next hand's prompt)
        applyImpressions(player, updates)

        // Track history entries for each updated impression
        for (const [targetId, impression] of Object.entries(updates)) {
          newHistoryEntries.push({ handNumber, playerId: player.id, targetId, impression })
        }

        // Update reactive state
        newImpressions[player.id] = {
          ...(newImpressions[player.id] || {}),
          ...updates,
        }

        // Cross-session persistence: save to IndexedDB by [profileId + targetName]
        const { saveStructuredImpression } = await import('../db/structured-impression-service')
        for (const [targetId, impression] of Object.entries(updates)) {
          const target = state.players.find(p => p.id === targetId)
          if (target) {
            saveStructuredImpression(player.profileId!, target.name, impression).catch(console.error)
          }
        }
      }
    }

    set(prev => ({
      impressions: newImpressions,
      impressionHistory: [...prev.impressionHistory, ...newHistoryEntries],
    }))
  },

  loadCrossSessionImpressions: async () => {
    const { engine } = get()
    if (!engine) return

    const state = engine.getState()
    const llmPlayers = state.players.filter(p => p.type === 'llm' && p.profileId)
    if (llmPlayers.length === 0) return

    const { getProfileImpressions } = await import('../db/structured-impression-service')
    const { applyImpressions } = await import('../games/poker/agent/poker-impressions')

    const newImpressions: ImpressionsMap = { ...get().impressions }

    for (const player of llmPlayers) {
      const stored = await getProfileImpressions(player.profileId!)
      if (Object.keys(stored).length === 0) continue

      // Map targetName → targetId using current game's players
      const otherPlayers = state.players.filter(p => p.id !== player.id)
      const idKeyedImpressions: Record<string, StructuredImpression> = {}

      for (const other of otherPlayers) {
        if (stored[other.name]) {
          idKeyedImpressions[other.id] = stored[other.name]
        }
      }

      if (Object.keys(idKeyedImpressions).length > 0) {
        // Apply to engine player in-memory (shared Map reference via shallow copy)
        applyImpressions(player, idKeyedImpressions)

        newImpressions[player.id] = {
          ...(newImpressions[player.id] || {}),
          ...idKeyedImpressions,
        }
      }
    }

    set({ impressions: newImpressions })
  },
}))
