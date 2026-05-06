/**
 * 端到端验证 — 验证插件系统可以同时承载德扑和斗地主。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  registerGame,
  getGame,
  getRegisteredGameTypes,
  clearRegistry,
} from '../../core/registry/game-registry'
import { pokerPlugin } from '../poker/poker-plugin'
import { doudizhuPlugin } from '../doudizhu/doudizhu-plugin'
import { Gateway } from '../../core/gateway/gateway'
import type { LLMClient } from '../../core/gateway/gateway'

describe('Plugin System E2E', () => {
  beforeEach(() => {
    clearRegistry()
    registerGame(pokerPlugin)
    registerGame(doudizhuPlugin)
  })

  it('should register both games', () => {
    const types = getRegisteredGameTypes()
    expect(types).toContain('poker')
    expect(types).toContain('doudizhu')
    expect(types).toHaveLength(2)
  })

  it('poker plugin should have correct meta', () => {
    const plugin = getGame('poker')
    expect(plugin.meta.displayName).toBe('德州扑克')
    expect(plugin.meta.scoreLabel).toBe('筹码')
    expect(plugin.meta.roundLabel).toBe('手')
    expect(plugin.meta.maxPlayers).toBe(6)
  })

  it('doudizhu plugin should have correct meta', () => {
    const plugin = getGame('doudizhu')
    expect(plugin.meta.displayName).toBe('斗地主')
    expect(plugin.meta.scoreLabel).toBe('积分')
    expect(plugin.meta.roundLabel).toBe('局')
    expect(plugin.meta.maxPlayers).toBe(3)
  })

  it('poker engine should create valid game', () => {
    const plugin = getGame('poker')
    const engine = plugin.createEngine()
    const state = engine.createGame({
      seats: [
        { type: 'bot', name: 'A', chips: 1000 },
        { type: 'bot', name: 'B', chips: 1000 },
      ],
      smallBlind: 2,
      bigBlind: 4,
      sessionId: 'test',
    })
    expect(state).toBeDefined()
    expect(engine.meta.gameType).toBe('poker')
  })

  it('doudizhu engine should create valid game', () => {
    const plugin = getGame('doudizhu')
    const engine = plugin.createEngine()
    const state = engine.createGame({
      playerNames: ['A', 'B', 'C'],
      baseScore: 1,
      sessionId: 'test',
    })
    expect(state).toBeDefined()
    expect(engine.meta.gameType).toBe('doudizhu')
    // Verify 54 cards dealt (17*3 player hands + 3 kitty = 54)
    const totalCards = (state as any).players.reduce((s: number, p: any) => s + p.hand.length, 0) + ((state as any).kittyCards?.length || 0)
    expect(totalCards).toBe(54)
  })

  it('poker impression config should have 4 dimensions', () => {
    const plugin = getGame('poker')
    expect(plugin.impressionConfig.dimensions).toHaveLength(4)
    expect(plugin.impressionConfig.dimensions.map(d => d.key)).toEqual([
      'looseness', 'aggression', 'stickiness', 'honesty',
    ])
  })

  it('doudizhu impression config should have 3 dimensions', () => {
    const plugin = getGame('doudizhu')
    expect(plugin.impressionConfig.dimensions).toHaveLength(3)
    expect(plugin.impressionConfig.dimensions.map(d => d.key)).toEqual([
      'aggression', 'cooperation', 'memory',
    ])
  })

  it('doudizhu gateway should fallback to bot on LLM failure', async () => {
    const plugin = getGame('doudizhu')
    const engine = plugin.createEngine()
    const state = engine.createGame({
      playerNames: ['A', 'B', 'C'],
      baseScore: 1,
      sessionId: 'test',
    })

    const mockLLM: LLMClient = {
      chat: async () => { throw new Error('Network error') },
    }

    const gateway = new Gateway({
      engine,
      contextBuilder: plugin.contextBuilder,
      responseParser: plugin.responseParser,
      botStrategy: plugin.botStrategy,
      llmClient: mockLLM,
      maxRetries: 0,
    })

    const currentId = (state as any).players[(state as any).currentPlayerIndex].id
    const result = await gateway.requestAgentAction(state, currentId)
    expect(result.source).toBe('bot')
    expect(result.action).toBeDefined()
  })

  it('poker and doudizhu should have different context builders', () => {
    const poker = getGame('poker')
    const ddz = getGame('doudizhu')

    const pokerPrompt = poker.contextBuilder.buildSystemPrompt({ name: 'Test' }, {})
    const ddzPrompt = ddz.contextBuilder.buildSystemPrompt({ name: 'Test' }, {})

    // Both should produce non-empty strings
    expect(pokerPrompt.length).toBeGreaterThan(0)
    expect(ddzPrompt.length).toBeGreaterThan(0)

    // They should be different (different game rules)
    expect(pokerPrompt).not.toBe(ddzPrompt)

    // Poker prompt should mention poker-specific terms
    expect(ddzPrompt).toContain('斗地主')
  })
})
