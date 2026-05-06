/**
 * Tests for core protocols — 验证类型约束和 Registry 功能。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import type {
  EngineProtocol,
  EngineMeta,
  AvailableActionInfo,
  ActionResult,
  GameEvent,
  ContextBuilder,
  ResponseParser,
  BotStrategy,
  ImpressionConfig,
  GamePlugin,
  GatewayProtocol,
  AgentActionResult,
  ImpressionUpdateResult,
} from '../protocols/index'
import {
  registerGame,
  getGame,
  getRegisteredGameTypes,
  getAllPlugins,
  clearRegistry,
} from '../registry/game-registry'

// ---- Mock 实现用于类型验证 ----

interface MockState {
  phase: string
  players: Array<{ id: string; score: number }>
}
interface MockAction {
  type: string
  playerId: string
  value?: number
}
interface MockConfig {
  playerCount: number
  maxScore: number
}

/** 最小 mock engine，验证 EngineProtocol 接口 */
class MockEngine implements EngineProtocol<MockState, MockAction, MockConfig> {
  readonly meta: EngineMeta = {
    gameType: 'mock',
    displayName: 'Mock Game',
    minPlayers: 2,
    maxPlayers: 4,
    phases: ['setup', 'play', 'end'],
  }

  createGame(config: MockConfig): MockState {
    return {
      phase: 'setup',
      players: Array.from({ length: config.playerCount }, (_, i) => ({
        id: `p${i}`,
        score: 0,
      })),
    }
  }

  getAvailableActions(state: MockState, playerId: string): AvailableActionInfo[] {
    if (state.phase !== 'play') return []
    return [
      { type: 'score', constraints: { value: { min: 1, max: 10 } } },
      { type: 'pass' },
    ]
  }

  applyAction(state: MockState, action: MockAction): ActionResult<MockState> {
    const player = state.players.find(p => p.id === action.playerId)
    if (!player) return { ok: false, error: 'Player not found' }

    const newState: MockState = {
      ...state,
      players: state.players.map(p =>
        p.id === action.playerId
          ? { ...p, score: p.score + (action.value || 0) }
          : p,
      ),
    }
    return { ok: true, state: newState, events: [{ type: 'scored', payload: { playerId: action.playerId } }] }
  }

  validateAction(state: MockState, action: MockAction): { valid: boolean; error?: string } {
    if (state.phase !== 'play') return { valid: false, error: 'Not in play phase' }
    if (!state.players.find(p => p.id === action.playerId)) return { valid: false, error: 'Invalid player' }
    return { valid: true }
  }

  serialize(state: MockState): string {
    return JSON.stringify(state)
  }

  deserialize(data: string): MockState {
    return JSON.parse(data) as MockState
  }
}

// ---- EngineProtocol Tests ----

describe('EngineProtocol', () => {
  let engine: EngineProtocol<MockState, MockAction, MockConfig>

  beforeEach(() => {
    engine = new MockEngine()
  })

  it('should expose meta information', () => {
    expect(engine.meta.gameType).toBe('mock')
    expect(engine.meta.displayName).toBe('Mock Game')
    expect(engine.meta.minPlayers).toBe(2)
    expect(engine.meta.maxPlayers).toBe(4)
    expect(engine.meta.phases).toEqual(['setup', 'play', 'end'])
  })

  it('should create game from config', () => {
    const state = engine.createGame({ playerCount: 3, maxScore: 100 })
    expect(state.phase).toBe('setup')
    expect(state.players).toHaveLength(3)
    expect(state.players[0].id).toBe('p0')
  })

  it('should return available actions for play phase', () => {
    const state: MockState = { phase: 'play', players: [{ id: 'p0', score: 0 }] }
    const actions = engine.getAvailableActions(state, 'p0')
    expect(actions).toHaveLength(2)
    expect(actions[0].type).toBe('score')
    expect(actions[0].constraints?.value).toEqual({ min: 1, max: 10 })
    expect(actions[1].type).toBe('pass')
  })

  it('should return empty actions for non-play phase', () => {
    const state: MockState = { phase: 'setup', players: [{ id: 'p0', score: 0 }] }
    expect(engine.getAvailableActions(state, 'p0')).toHaveLength(0)
  })

  it('should apply action successfully', () => {
    const state: MockState = { phase: 'play', players: [{ id: 'p0', score: 5 }] }
    const result = engine.applyAction(state, { type: 'score', playerId: 'p0', value: 3 })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.state.players[0].score).toBe(8)
      expect(result.events).toHaveLength(1)
      expect(result.events[0].type).toBe('scored')
    }
  })

  it('should fail apply for invalid player', () => {
    const state: MockState = { phase: 'play', players: [{ id: 'p0', score: 0 }] }
    const result = engine.applyAction(state, { type: 'score', playerId: 'nobody' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('not found')
    }
  })

  it('should validate actions correctly', () => {
    const state: MockState = { phase: 'play', players: [{ id: 'p0', score: 0 }] }
    expect(engine.validateAction(state, { type: 'score', playerId: 'p0' }).valid).toBe(true)
    expect(engine.validateAction(state, { type: 'score', playerId: 'nobody' }).valid).toBe(false)

    const setupState: MockState = { phase: 'setup', players: [{ id: 'p0', score: 0 }] }
    expect(engine.validateAction(setupState, { type: 'score', playerId: 'p0' }).valid).toBe(false)
  })

  it('should serialize and deserialize state', () => {
    const state: MockState = { phase: 'play', players: [{ id: 'p0', score: 42 }] }
    const serialized = engine.serialize(state)
    const restored = engine.deserialize(serialized)
    expect(restored).toEqual(state)
  })
})

// ---- GameRegistry Tests ----

describe('GameRegistry', () => {
  beforeEach(() => {
    clearRegistry()
  })

  const createMockPlugin = (gameType: string): GamePlugin => ({
    gameType,
    createEngine: () => new MockEngine(),
    defaultConfig: { playerCount: 2, maxScore: 100 },
    contextBuilder: {} as ContextBuilder<MockState, MockAction>,
    responseParser: {} as ResponseParser<MockAction>,
    botStrategy: {} as BotStrategy<MockState, MockAction>,
    impressionConfig: {
      dimensions: [{ key: 'skill', label: '技巧', description: '玩家技巧', range: [1, 10] as [number, number], default: 5 }],
      emaAlpha: 0.3,
    },
    BoardComponent: () => null,
    SeatComponent: () => null,
    HistoryDetailComponent: () => null,
    SetupComponent: () => null,
    meta: {
      gameType,
      displayName: `${gameType} Game`,
      minPlayers: 2,
      maxPlayers: 6,
      phases: ['play'],
      scoreLabel: '分数',
      roundLabel: '局',
    },
  })

  it('should register and retrieve a plugin', () => {
    const plugin = createMockPlugin('poker')
    registerGame(plugin)
    const retrieved = getGame('poker')
    expect(retrieved).toBe(plugin)
    expect(retrieved.gameType).toBe('poker')
  })

  it('should throw for unregistered game type', () => {
    expect(() => getGame('nonexistent')).toThrow('not registered')
  })

  it('should list registered game types', () => {
    registerGame(createMockPlugin('poker'))
    registerGame(createMockPlugin('doudizhu'))
    const types = getRegisteredGameTypes()
    expect(types).toContain('poker')
    expect(types).toContain('doudizhu')
    expect(types).toHaveLength(2)
  })

  it('should return all plugins', () => {
    registerGame(createMockPlugin('poker'))
    registerGame(createMockPlugin('uno'))
    const plugins = getAllPlugins()
    expect(plugins).toHaveLength(2)
    expect(plugins.map(p => p.gameType).sort()).toEqual(['poker', 'uno'])
  })

  it('should overwrite existing plugin with same gameType', () => {
    const p1 = createMockPlugin('poker')
    const p2 = createMockPlugin('poker')
    registerGame(p1)
    registerGame(p2)
    expect(getGame('poker')).toBe(p2)
    expect(getRegisteredGameTypes()).toHaveLength(1)
  })

  it('should clear registry', () => {
    registerGame(createMockPlugin('poker'))
    expect(getRegisteredGameTypes()).toHaveLength(1)
    clearRegistry()
    expect(getRegisteredGameTypes()).toHaveLength(0)
  })
})

// ---- ImpressionConfig Tests ----

describe('ImpressionConfig', () => {
  it('should define valid dimension structure', () => {
    const config: ImpressionConfig = {
      dimensions: [
        { key: 'looseness', label: '入池意愿', description: '1=极紧 10=极松', range: [1, 10], default: 5 },
        { key: 'aggression', label: '攻击性', description: '1=被动 10=激进', range: [1, 10], default: 5 },
      ],
      emaAlpha: 0.3,
    }
    expect(config.dimensions).toHaveLength(2)
    expect(config.emaAlpha).toBe(0.3)
    for (const dim of config.dimensions) {
      expect(dim.range[0]).toBeLessThan(dim.range[1])
      expect(dim.default).toBeGreaterThanOrEqual(dim.range[0])
      expect(dim.default).toBeLessThanOrEqual(dim.range[1])
    }
  })
})
