/**
 * ddz-game-store — 斗地主专属 game store。
 *
 * 遵循游戏自治原则：完全独立于 poker 的 game-store，
 * 使用 DoudizhuEngine + Gateway，不依赖任何 poker 类型。
 */

import { create } from 'zustand'
import type { DdzGameState, DdzAction, DdzConfig } from '../engine/ddz-types'
import { ddzCardToString } from '../engine/ddz-types'
import { DoudizhuEngine } from '../engine/doudizhu-engine'
import type { APIProfile } from '../../../agent/llm-client'
import { callLLMStreaming } from '../../../agent/llm-client'
import { Gateway } from '../../../core/gateway/gateway'
import type { LLMClient, LLMClientFactory } from '../../../core/gateway/gateway'
import { getGame } from '../../../core/registry/game-registry'

// ── Types ──

interface DdzTimingConfig {
  minActionInterval: number
  thinkingTimeout: number
}

export interface DdzActionLogEntry {
  playerName: string
  action: string
  highlight?: boolean
}

/** 思考链条目 */
export interface DdzThinkingEntry {
  playerId: string
  playerName: string
  content: string
}

// ── Module-level locks ──

let isProcessingAction = false
const pendingDecisions = new Set<string>()

// ── Store Interface ──

interface DdzGameStore {
  // Engine
  engine: DoudizhuEngine | null
  gameState: DdzGameState | null
  isRunning: boolean
  statusText: string

  // Timing
  timingConfig: DdzTimingConfig

  // Bot/LLM state
  thinkingBotId: string | null
  thinkingStartTime: number | null
  llmThoughts: Record<string, string>
  thinkingChain: DdzThinkingEntry[]
  lastBotAction: { playerId: string; action: string } | null
  isBotActing: boolean

  // Action log
  actionLog: DdzActionLogEntry[]

  // Scoring — 累计积分
  scoreMap: Record<string, number>
  scoreHistory: Array<{ round: number; scores: Record<string, number> }>

  // UI
  autoPlay: boolean
  showRanking: boolean
  /** 视角切换: 纯AI模式下选择从哪个玩家视角观看 */
  viewAsPlayerIndex: number

  // Gateway
  gateway: Gateway<DdzGameState, DdzAction> | null

  // Human action resolver
  _humanResolve: ((action: DdzAction) => void) | null

  // Actions
  initGame: (
    seats: Array<{ type: string; name: string; profileId?: string; systemPrompt?: string }>,
    timingConfig: DdzTimingConfig,
    gameConfig: Partial<DdzConfig>,
    getProfile: (id: string) => APIProfile | undefined,
  ) => void
  startNewRound: () => void
  playerAction: (action: DdzAction) => void
  processNextAction: () => Promise<void>
  syncState: () => void
  resetGame: () => void
  endGame: () => void
  dismissRanking: () => void
  setAutoPlay: (auto: boolean) => void
  setViewAsPlayer: (index: number) => void

  // Internal
  setThinkingBotId: (id: string | null) => void
  clearLastBotAction: () => void
  setIsBotActing: (v: boolean) => void
}

// ── Store ──

export const useDdzGameStore = create<DdzGameStore>((set, get) => ({
  engine: null,
  gameState: null,
  isRunning: false,
  statusText: '配置好座位后点击"开始游戏"',
  timingConfig: { minActionInterval: 1500, thinkingTimeout: 0 },

  thinkingBotId: null,
  thinkingStartTime: null,
  llmThoughts: {},
  thinkingChain: [],
  lastBotAction: null,
  isBotActing: false,

  actionLog: [],

  scoreMap: {},
  scoreHistory: [],

  autoPlay: false,
  showRanking: false,
  viewAsPlayerIndex: 0,

  gateway: null,
  _humanResolve: null,

  // ────────────────────────────────
  // initGame
  // ────────────────────────────────
  initGame: (seats, timingConfig, gameConfig, getProfile) => {
    const engine = new DoudizhuEngine()

    // 构建 DdzConfig — 从座位信息提取玩家名
    const nonEmpty = seats.filter(s => s.type !== 'empty')
    const config: DdzConfig = {
      playerNames: nonEmpty.map(s => s.name),
      baseScore: gameConfig.baseScore ?? 1,
      sessionId: gameConfig.sessionId ?? crypto.randomUUID(),
    }

    const initialState = engine.createGame(config)

    // 把座位信息注入到 players（type / profileId / systemPrompt）
    for (let i = 0; i < nonEmpty.length && i < initialState.players.length; i++) {
      const seat = nonEmpty[i]
      const player = initialState.players[i]
      player.type = seat.type as 'human' | 'bot' | 'llm'
      player.profileId = seat.profileId
      player.systemPrompt = seat.systemPrompt
    }

    // 创建 Gateway
    let gateway: Gateway<DdzGameState, DdzAction> | null = null
    try {
      const plugin = getGame('doudizhu')
      const timeoutMs = timingConfig.thinkingTimeout

      // FIX 1.1: Use initialState directly instead of get().gameState to avoid race condition
      const llmClientFactory: LLMClientFactory = (playerId: string) => {
        const player = initialState.players.find(p => p.id === playerId)
        if (!player?.profileId) return null
        const profile = getProfile(player.profileId)
        if (!profile) return null

        const client: LLMClient = {
          async chat(messages, options) {
            const onChunk: (delta: string, fullText: string) => void = options?.onChunk
              ? (_delta: string, fullText: string) => {
                  const match = fullText.match(/<thinking>([\s\S]*?)(?:<\/thinking>|$)/)
                  if (match) options.onChunk!(match[1].trim())
                }
              : () => {}
            const content = await callLLMStreaming(
              profile,
              messages as import('../../../agent/llm-client').ChatMessage[],
              onChunk,
              timeoutMs,
              options?.signal,
            )
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
    } catch {
      // Registry not ready, will use bot fallback
    }

    // 重置锁
    isProcessingAction = false
    pendingDecisions.clear()

    set({
      engine,
      gameState: initialState,
      isRunning: true,
      statusText: `第 ${initialState.roundNumber} 局 — 叫地主中`,
      timingConfig,
      gateway,
      llmThoughts: {},
      thinkingChain: [],
      actionLog: [],
      thinkingBotId: null,
      thinkingStartTime: null,
      lastBotAction: null,
      isBotActing: false,
      autoPlay: false,
      showRanking: false,
      _humanResolve: null,
    })

    // 如果第一个玩家不是 human，自动开始
    const firstPlayer = initialState.players[initialState.currentPlayerIndex]
    if (firstPlayer && firstPlayer.type !== 'human') {
      set({ isBotActing: true })
    }
  },

  // ────────────────────────────────
  // startNewRound
  // ────────────────────────────────
  startNewRound: () => {
    const { engine, gameState } = get()
    if (!engine || !gameState) return

    // 用原始配置重新创建
    const config: DdzConfig = {
      playerNames: gameState.players.map(p => p.name),
      baseScore: gameState.baseScore,
      sessionId: gameState.sessionId,
    }

    const newState = engine.createGame(config)

    // 保持 player type/profileId/systemPrompt
    for (let i = 0; i < gameState.players.length && i < newState.players.length; i++) {
      newState.players[i].type = gameState.players[i].type
      newState.players[i].profileId = gameState.players[i].profileId
      newState.players[i].systemPrompt = gameState.players[i].systemPrompt
    }
    newState.roundNumber = gameState.roundNumber + 1

    isProcessingAction = false
    pendingDecisions.clear()

    const firstPlayer = newState.players[newState.currentPlayerIndex]

    set({
      gameState: newState,
      statusText: `第 ${newState.roundNumber} 局 — 叫地主中`,
      llmThoughts: {},
      thinkingChain: [],
      actionLog: [],
      thinkingBotId: null,
      thinkingStartTime: null,
      lastBotAction: null,
      showRanking: false,
      isBotActing: firstPlayer?.type !== 'human',
      _humanResolve: null,
    })
  },

  // ────────────────────────────────
  // playerAction — 人类操作
  // ────────────────────────────────
  playerAction: (action: DdzAction) => {
    const resolve = get()._humanResolve
    if (resolve) {
      resolve(action)
      set({ _humanResolve: null })
    }
  },

  // ────────────────────────────────
  // processNextAction — 核心循环
  // ────────────────────────────────
  processNextAction: async () => {
    if (isProcessingAction) return
    isProcessingAction = true

    try {
      const { engine, gateway, timingConfig } = get()
      const state = get().gameState
      if (!engine || !state) return

      const myRound = state.roundNumber

      const isStale = () => {
        const s = get().gameState
        return !s || s.roundNumber !== myRound
      }

      // 游戏结束
      if (state.phase === 'finished') {
        set({ isBotActing: false })
        return
      }

      const currentPlayer = state.players[state.currentPlayerIndex]
      if (!currentPlayer) {
        set({ isBotActing: false })
        return
      }

      // ── Human ──
      if (currentPlayer.type === 'human') {
        set({ isBotActing: false })

        // 等待 UI 调 playerAction
        const action = await new Promise<DdzAction>((resolve) => {
          set({ _humanResolve: resolve })
        })

        if (isStale()) return

        // 执行
        const result = engine.applyAction(get().gameState!, action)
        if (!result.ok) return // 不合法就忽略
        set({ gameState: result.state })
        _logAction(set, get, currentPlayer, action)
        get().syncState()

        // 下一个
        const nextPlayer = result.state.players[result.state.currentPlayerIndex]
        if (result.state.phase !== 'finished' && nextPlayer?.type !== 'human') {
          set({ isBotActing: true })
        }
        return
      }

      // ── Bot / LLM ──

      const decisionKey = `${myRound}-${currentPlayer.id}`
      if (pendingDecisions.has(decisionKey)) return
      pendingDecisions.add(decisionKey)
      try {

      set({ thinkingBotId: currentPlayer.id, thinkingStartTime: Date.now() })

      let action: DdzAction
      let thinking: string | undefined

      try {
        if (gateway) {
          // Gateway path
          const timeoutMs = timingConfig.thinkingTimeout
          const controller = new AbortController()
          let timeoutId: ReturnType<typeof setTimeout> | null = null
          if (timeoutMs > 0) {
            timeoutId = setTimeout(() => controller.abort('timeout'), timeoutMs)
          }

          try {
            const result = await gateway.requestAgentAction(state, currentPlayer.id, {
              personality: { name: currentPlayer.name, systemPrompt: currentPlayer.systemPrompt },
              signal: controller.signal,
              timeout: timeoutMs,
              onChunk: (chunk: string) => {
                if (get().thinkingBotId !== currentPlayer.id) return
                set(prev => ({
                  llmThoughts: { ...prev.llmThoughts, [currentPlayer.id]: chunk },
                }))
              },
            })

            action = result.action as DdzAction
            thinking = result.thinking
          } finally {
            if (timeoutId) clearTimeout(timeoutId)
          }
        } else {
          // 无 gateway fallback — 直接用 bot strategy
          const plugin = getGame('doudizhu')
          action = plugin.botStrategy.chooseAction(state, currentPlayer.id)
        }
      } catch (err) {
        // 错误 fallback: pass 或出最小牌
        const plugin = getGame('doudizhu')
        action = plugin.botStrategy.chooseAction(state, currentPlayer.id)
        thinking = `⚠ 出错: ${err instanceof Error ? err.message : String(err)}`
      }

      pendingDecisions.delete(decisionKey)
      if (isStale()) {
        set({ thinkingBotId: null, thinkingStartTime: null })
      }

      // 记录思考 — bot 也记录动作摘要到 thinkingChain
      const thinkingToRecord = thinking
        || (currentPlayer.type === 'bot' ? `🎯 Bot 决策: ${_formatDdzAction(action)}` : undefined)
      if (thinkingToRecord) {
        set(prev => ({
          llmThoughts: { ...prev.llmThoughts, [currentPlayer.id]: thinkingToRecord },
          thinkingChain: [...prev.thinkingChain, {
            playerId: currentPlayer.id,
            playerName: currentPlayer.name,
            content: thinkingToRecord,
          }],
        }))
      }

      // 等待展示时间 — 让思维气泡可见
      // Bot: 至少 minActionInterval (默认1.5s)
      // LLM 有思考内容: 5秒让用户阅读
      // LLM 无思考内容: minActionInterval
      const delay = (currentPlayer.type === 'llm' && thinking)
        ? Math.max(5000, timingConfig.minActionInterval)
        : timingConfig.minActionInterval
      if (delay > 0) await new Promise(r => setTimeout(r, delay))
      if (isStale()) { set({ thinkingBotId: null, thinkingStartTime: null }); return }

      // 执行动作
      const currentState = get().gameState!
      const result = engine.applyAction(currentState, action)
      if (!result.ok) {
        // 如果 action 不合法，用 bot fallback
        const plugin = getGame('doudizhu')
        const fallback = plugin.botStrategy.chooseAction(currentState, currentPlayer.id)
        const fallbackResult = engine.applyAction(currentState, fallback)
        if (fallbackResult.ok) {
          set({ gameState: fallbackResult.state })
          _logAction(set, get, currentPlayer, fallback)
        }
      } else {
        set({ gameState: result.state })
        _logAction(set, get, currentPlayer, action)
      }

      // 清理 thinking 状态
      set({
        lastBotAction: {
          playerId: currentPlayer.id,
          action: _formatDdzAction(action),
        },
        thinkingBotId: null,
        thinkingStartTime: null,
      })

      get().syncState()

      // 短暂展示动作
      await new Promise(r => setTimeout(r, 600))
      if (isStale()) { set({ lastBotAction: null }); return }
      set({ lastBotAction: null })

      // 下一步
      const newState = get().gameState!
      if (newState.phase === 'finished') {
        set({ isBotActing: false })
        const winner = newState.players.find(p => p.hand.length === 0)
        const roleWin = winner?.role === 'landlord' ? '地主胜!' : '农民胜!'
        const isLandlordWin = winner?.role === 'landlord'
        const roundScore = newState.baseScore * newState.multiplier

        // 累计积分
        const prevScores = { ...get().scoreMap }
        const roundDeltas: Record<string, number> = {}
        for (const p of newState.players) {
          const delta = p.role === 'landlord'
            ? (isLandlordWin ? roundScore * 2 : -roundScore * 2)
            : (isLandlordWin ? -roundScore : roundScore)
          prevScores[p.id] = (prevScores[p.id] || 0) + delta
          roundDeltas[p.id] = delta
        }

        set({
          statusText: `游戏结束 — ${roleWin} (${winner?.name})`,
          showRanking: true,
          scoreMap: prevScores,
          scoreHistory: [...get().scoreHistory, { round: newState.roundNumber, scores: roundDeltas }],
        })
        if (get().autoPlay) {
          await new Promise(r => setTimeout(r, 3000))
          if (get().autoPlay) get().startNewRound()
        }
      } else {
        const nextPlayer = newState.players[newState.currentPlayerIndex]
        if (nextPlayer?.type === 'human') {
          set({ isBotActing: false })
        }
        // 非 human: isBotActing 保持 true → 被 finally 重触发
      }
      } finally {
        pendingDecisions.delete(decisionKey)
      }
    } finally {
      isProcessingAction = false
      if (get().isBotActing) {
        const s = get().gameState
        if (s && s.phase !== 'finished') {
          set({ isBotActing: false })
          queueMicrotask(() => {
            if (!isProcessingAction) set({ isBotActing: true })
          })
        }
      }
    }
  },

  // ────────────────────────────────
  // syncState
  // ────────────────────────────────
  syncState: () => {
    const state = get().gameState
    if (!state) return

    const phaseNames: Record<string, string> = {
      bidding: '叫地主', playing: '出牌中', finished: '已结束',
    }
    const landlord = state.players.find(p => p.role === 'landlord')
    const current = state.players[state.currentPlayerIndex]
    let statusText = `第 ${state.roundNumber} 局 — ${phaseNames[state.phase] || state.phase}`

    if (state.phase === 'bidding') {
      if (current) statusText += ` · 轮到: ${current.name}`
      if (state.highestBid > 0) statusText += ` · 当前最高: ${state.highestBid}分`
    }
    if (landlord && state.phase === 'playing') {
      statusText += ` · 地主: ${landlord.name}`
    }
    if (current && state.phase === 'playing') {
      statusText += ` · 轮到: ${current.name}`
    }
    if (state.multiplier > 1) {
      statusText += ` · ${state.multiplier}倍`
    }

    set({ statusText })
  },

  // ── Simple setters ──
  setAutoPlay: (auto) => set({ autoPlay: auto }),
  setViewAsPlayer: (index) => set({ viewAsPlayerIndex: index }),
  resetGame: () => {
    isProcessingAction = false
    pendingDecisions.clear()
    set({
      engine: null, gameState: null, isRunning: false, gateway: null,
      statusText: '配置好座位后点击"开始游戏"',
      thinkingBotId: null, thinkingStartTime: null, llmThoughts: {}, thinkingChain: [],
      lastBotAction: null, isBotActing: false, actionLog: [],
      scoreMap: {}, scoreHistory: [],
      autoPlay: false, showRanking: false, viewAsPlayerIndex: 0, _humanResolve: null,
    })
  },
  endGame: () => set({ autoPlay: false, isBotActing: false, showRanking: true }),  // FIX 3.1: Stop bot loop
  dismissRanking: () => set({ showRanking: false }),
  setThinkingBotId: (id) => set({ thinkingBotId: id }),
  clearLastBotAction: () => set({ lastBotAction: null }),
  setIsBotActing: (v) => set({ isBotActing: v }),
}))

// ── Helpers ──

function _formatDdzAction(action: DdzAction): string {
  if (action.type === 'bid') {
    return action.bidScore === 0 ? '不叫' : `${action.bidScore}分`
  }
  if (action.type === 'pass') return '不出'
  if (action.type === 'play' && action.cards) {
    return action.cards.map(c => ddzCardToString(c)).join(' ')
  }
  return action.type
}

type SetFn = (partial: Partial<DdzGameStore> | ((s: DdzGameStore) => Partial<DdzGameStore>)) => void
type GetFn = () => DdzGameStore

function _logAction(set: SetFn, _get: GetFn, player: { name: string }, action: DdzAction) {
  set((prev) => ({
    actionLog: [...prev.actionLog, {
      playerName: player.name,
      action: _formatDdzAction(action),
      highlight: action.type === 'play',
    }],
  }))
}
