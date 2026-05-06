import { create } from 'zustand'
import type { SessionSeatConfig } from '../db/database'

export interface SessionConfig {
  seats: SessionSeatConfig[]
  smallBlind: number
  bigBlind: number
  defaultChips: number
  minActionInterval: number
  thinkingTimeout: number
  defaultSystemPrompt: string
}

interface SessionStore {
  sessionId: string | null
  /** 当前 config 对应的 gameType */
  gameType: string
  config: SessionConfig
  configLoaded: boolean

  /** 为指定游戏加载/初始化 config (按 seatCount 创建座位) */
  loadConfigForGame: (gameType: string, seatCount: number) => void
  /** 兼容旧入口：加载 poker config */
  loadConfig: () => void
  updateSeat: (seatIndex: number, updates: Partial<SessionSeatConfig>) => void
  updateParams: (updates: Partial<Omit<SessionConfig, 'seats'>>) => void
  createSession: () => string
  resetConfig: () => void
}

const STORAGE_KEY_PREFIX = 'game-arena-session-config'
// Legacy key for migration
const LEGACY_STORAGE_KEY = 'poker-arena-session-config'

/** 获取当前游戏类型的 storage key */
function getStorageKey(gameType: string = 'poker'): string {
  return `${STORAGE_KEY_PREFIX}-${gameType}`
}

/** 为任意游戏生成默认 config (可变座位数) */
function buildDefaultConfig(gameType: string, seatCount: number): SessionConfig {
  const seats: SessionSeatConfig[] = Array.from({ length: seatCount }, (_, i) => ({
    seatIndex: i,
    type: 'bot' as const,
    name: `Bot ${i + 1}`,
    profileId: undefined,
  }))

  // 德扑用特定默认座位
  if (gameType === 'poker') {
    return { ...POKER_DEFAULTS }
  }

  return {
    seats,
    smallBlind: 0,
    bigBlind: 0,
    defaultChips: 0,
    minActionInterval: 1500,
    thinkingTimeout: 0,
    defaultSystemPrompt: '',
  }
}

/** 德扑默认配置 (保持兼容) */
const POKER_DEFAULTS: SessionConfig = {
  seats: [
    { seatIndex: 0, type: 'llm', name: 'Doubao-Seed-2.0-pro', profileId: 'seed-doubao' },
    { seatIndex: 1, type: 'llm', name: 'Kimi-K2.5', profileId: 'seed-kimi' },
    { seatIndex: 2, type: 'llm', name: 'DeepSeek-V3.2-Thinking', profileId: 'seed-deepseek' },
    { seatIndex: 3, type: 'llm', name: 'GLM-5', profileId: 'seed-glm' },
    { seatIndex: 4, type: 'llm', name: 'Qwen3.6-plus', profileId: 'seed-qwen' },
    { seatIndex: 5, type: 'llm', name: 'MiniMax-M2.7', profileId: 'seed-minimax' },
  ],
  smallBlind: 2,
  bigBlind: 4,
  defaultChips: 1000,
  minActionInterval: 1500,
  thinkingTimeout: 0,
  defaultSystemPrompt: '一位世界顶级德州扑克职业选手，正在参加一场高注额生存赛，目标是筹码最大化。你的核心能力：1) 熟练结合 GTO 与剥削性打法；2) 善用诈唬、半诈唬、薄价值下注、慢打等手段；3) 每次决策综合考虑底牌胜率、位置优势、筹码底池比、底池赔率、对手范围及牌面结构。分析时先评估局势和对手范围，再计算赔率，最后给出最优行动。',
}

function saveConfigToStorage(config: SessionConfig, gameType: string = 'poker') {
  try {
    localStorage.setItem(getStorageKey(gameType), JSON.stringify(config))
  } catch {
    // Silently ignore storage errors
  }
}

function loadConfigFromStorage(gameType: string = 'poker', seatCount: number = 6): SessionConfig | null {
  try {
    // Try new key first
    let raw = localStorage.getItem(getStorageKey(gameType))
    // Fallback to legacy key for migration
    if (!raw && gameType === 'poker') {
      raw = localStorage.getItem(LEGACY_STORAGE_KEY)
      if (raw) {
        // Migrate: save to new key, delete old
        localStorage.setItem(getStorageKey(gameType), raw)
        localStorage.removeItem(LEGACY_STORAGE_KEY)
      }
    }
    if (!raw) return null
    const parsed = JSON.parse(raw)
    // Basic validation
    if (!Array.isArray(parsed.seats) || parsed.seats.length !== seatCount) return null
    if (gameType === 'poker' && typeof parsed.smallBlind !== 'number') return null
    // Backfill new fields for old cached configs
    const defaults = buildDefaultConfig(gameType, seatCount)
    return {
      ...defaults,
      ...parsed,
      seats: parsed.seats.map((s: Record<string, unknown>) => ({ ...s })),
    }
  } catch {
    return null
  }
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessionId: null,
  gameType: 'poker',
  config: { ...POKER_DEFAULTS, seats: POKER_DEFAULTS.seats.map(s => ({ ...s })) },
  configLoaded: false,

  loadConfigForGame: (gameType: string, seatCount: number) => {
    const saved = loadConfigFromStorage(gameType, seatCount)
    if (saved) {
      set({ config: saved, configLoaded: true, gameType })
    } else {
      const defaults = buildDefaultConfig(gameType, seatCount)
      const cfg = { ...defaults, seats: defaults.seats.map(s => ({ ...s })) }
      set({ config: cfg, configLoaded: true, gameType })
    }
  },

  /** 兼容旧入口（poker 6-max） */
  loadConfig: () => {
    get().loadConfigForGame('poker', 6)
  },

  updateSeat: (seatIndex: number, updates: Partial<SessionSeatConfig>) => {
    set(state => {
      const seats = state.config.seats.map(s =>
        s.seatIndex === seatIndex ? { ...s, ...updates } : s
      )
      const newConfig = { ...state.config, seats }
      saveConfigToStorage(newConfig, state.gameType)
      return { config: newConfig }
    })
  },

  updateParams: (updates: Partial<Omit<SessionConfig, 'seats'>>) => {
    set(state => {
      const newConfig = { ...state.config, ...updates }
      saveConfigToStorage(newConfig, state.gameType)
      return { config: newConfig }
    })
  },

  createSession: () => {
    const sessionId = crypto.randomUUID()
    set({ sessionId })

    // Persist session to IndexedDB
    const { config } = get()
    import('../db/database').then(({ db }) => {
      db.sessions.put({
        id: sessionId,
        timestamp: Date.now(),
        seats: config.seats,
        smallBlind: config.smallBlind,
        bigBlind: config.bigBlind,
        minActionInterval: config.minActionInterval,
        thinkingTimeout: config.thinkingTimeout,
      }).catch(console.error)
    })

    return sessionId
  },

  resetConfig: () => {
    const { gameType } = get()
    const seatCount = get().config.seats.length
    const defaults = buildDefaultConfig(gameType, seatCount)
    const defaultCfg = { ...defaults, seats: defaults.seats.map(s => ({ ...s })) }
    saveConfigToStorage(defaultCfg, gameType)
    set({
      sessionId: null,
      config: defaultCfg,
    })
  },
}))
