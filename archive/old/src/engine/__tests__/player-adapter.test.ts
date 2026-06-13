import { describe, it, expect, vi } from 'vitest'
import { BotAdapter, LLMAdapter, HumanAdapter } from '../../agent/player-adapter'
import type { Player } from '../../types/player'
import type { GameState } from '../../types/game'
import type { Card } from '../../types/card'
import type { AvailableAction } from '../../games/poker/engine/poker-engine'
import { BotAI } from '../../games/poker/agent/poker-bot'

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: 'player-1',
    name: 'TestPlayer',
    type: 'bot',
    chips: 1000,
    status: 'active',
    holeCards: [
      { rank: 'A', suit: 'hearts' },
      { rank: 'K', suit: 'spades' },
    ] as Card[],
    currentBet: 0,
    totalBetThisRound: 0,
    seatIndex: 0,
    hasActed: false,
    ...overrides,
  }
}

function makeGameState(): GameState {
  return {
    id: 'test-game',
    phase: 'preflop',
    communityCards: [],
    pot: 15,
    sidePots: [],
    players: [makePlayer()],
    dealerIndex: 0,
    currentPlayerIndex: 0,
    smallBlind: 2,
    bigBlind: 4,
    minRaise: 2,
    deck: [],
    actionHistory: [],
    handNumber: 1,
    sessionId: 'test-session',
    timingConfig: { minActionInterval: 1500, thinkingTimeout: 30000 },
  }
}

describe('BotAdapter', () => {
  it('returns a valid decision from BotAI', async () => {
    const botAI = new BotAI()
    const adapter = new BotAdapter(botAI)
    const player = makePlayer()
    const state = makeGameState()
    const validActions: AvailableAction[] = [
      { type: 'fold' },
      { type: 'check' },
      { type: 'bet', minAmount: 2, maxAmount: 2 },
    ]

    const result = await adapter.decide(player, state, validActions)
    expect(result).toBeDefined()
    expect(result.type).toBeDefined()
    expect(typeof result.amount).toBe('number')
  })
})

describe('HumanAdapter', () => {
  it('resolves when action is submitted', async () => {
    const adapter = new HumanAdapter()
    const player = makePlayer({ type: 'human' })
    const state = makeGameState()
    const validActions: AvailableAction[] = [{ type: 'fold' }, { type: 'check' }]

    const promise = adapter.decide(player, state, validActions)

    // Verify waiting
    expect(adapter.isWaiting()).toBe(true)

    // Resolve
    adapter.resolveAction('check', 0)

    const result = await promise
    expect(result.type).toBe('check')
    expect(result.amount).toBe(0)
    expect(adapter.isWaiting()).toBe(false)
  })
})

describe('LLMAdapter', () => {
  it('folds when no profileId is set', async () => {
    const adapter = new LLMAdapter(() => undefined)
    const player = makePlayer({ type: 'llm' }) // no profileId
    const state = makeGameState()

    const result = await adapter.decide(player, state, [{ type: 'fold' }])
    expect(result.type).toBe('fold')
  })

  it('folds when profile is not found', async () => {
    const adapter = new LLMAdapter(() => undefined)
    const player = makePlayer({ type: 'llm', profileId: 'nonexistent' })
    const state = makeGameState()

    const result = await adapter.decide(player, state, [{ type: 'fold' }])
    expect(result.type).toBe('fold')
  })

  // Note: Full LLM adapter test would require mocking fetch,
  // which is tested via response-parser tests above.
  it('handles API error gracefully', async () => {
    // Mock a profile that will fail
    const adapter = new LLMAdapter(
      () => ({
        id: 'test',
        name: 'Test',
        baseURL: 'http://localhost:99999', // Will fail to connect
        apiKey: '',
        model: 'test',
      }),
      1000, // Short timeout
    )

    const player = makePlayer({ type: 'llm', profileId: 'test' })
    const state = makeGameState()

    // Suppress console.warn for this test
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await adapter.decide(player, state, [{ type: 'fold' }])
    expect(result.type).toBe('fold')
    warnSpy.mockRestore()
  })
})
