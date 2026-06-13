/**
 * PokerEngineAdapter tests — 验证适配器正确实现 EngineProtocol。
 */
import { describe, it, expect } from 'vitest'
import { PokerEngineAdapter } from '../engine/poker-engine-adapter'
import type { GameConfig } from '../engine/poker-engine'
import type { EngineProtocol } from '../../../core/protocols'
import type { GameState } from '../../../types/game'
import type { PlayerAction } from '../../../types/action'

describe('PokerEngineAdapter', () => {
  const adapter = new PokerEngineAdapter()

  const testConfig: GameConfig = {
    seats: [
      { type: 'bot', name: 'Alice', chips: 1000 },
      { type: 'bot', name: 'Bob', chips: 1000 },
      { type: 'bot', name: 'Charlie', chips: 1000 },
    ],
    smallBlind: 2,
    bigBlind: 4,
    sessionId: 'test-session',
  }

  it('should implement EngineProtocol interface', () => {
    // Type check: adapter satisfies EngineProtocol
    const proto: EngineProtocol<GameState, PlayerAction, GameConfig> = adapter
    expect(proto.meta.gameType).toBe('poker')
  })

  it('should expose correct meta', () => {
    expect(adapter.meta.gameType).toBe('poker')
    expect(adapter.meta.displayName).toBe('德州扑克')
    expect(adapter.meta.minPlayers).toBe(2)
    expect(adapter.meta.maxPlayers).toBe(6)
    expect(adapter.meta.phases).toContain('preflop')
    expect(adapter.meta.phases).toContain('showdown')
  })

  it('should create game from config', () => {
    const state = adapter.createGame(testConfig)
    expect(state.phase).toBe('waiting')
    expect(state.players).toHaveLength(3)
    expect(state.smallBlind).toBe(2)
    expect(state.bigBlind).toBe(4)
  })

  it('should serialize and deserialize state', () => {
    const state = adapter.createGame(testConfig)
    const serialized = adapter.serialize(state)
    expect(typeof serialized).toBe('string')
    const deserialized = adapter.deserialize(serialized)
    expect(deserialized.phase).toBe(state.phase)
    expect(deserialized.players).toHaveLength(state.players.length)
    expect(deserialized.smallBlind).toBe(state.smallBlind)
  })

  it('should validate actions — reject wrong player', () => {
    const state = adapter.createGame(testConfig)
    // Wrong player should be rejected
    const result = adapter.validateAction(state, {
      playerId: 'nonexistent-player',
      type: 'check',
      amount: 0,
      timestamp: Date.now(),
    })
    expect(result.valid).toBe(false)
    expect(result.error).toContain('Not this player')
  })

  it('should return empty actions for non-current player', () => {
    const state = adapter.createGame(testConfig)
    const actions = adapter.getAvailableActions(state, 'nonexistent')
    expect(actions).toHaveLength(0)
  })
})
