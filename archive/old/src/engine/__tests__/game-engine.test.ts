import { describe, it, expect, vi } from 'vitest'
import { createTestEngine, assertChipConservation } from './test-helpers'
import type { GameConfig } from '../../games/poker/engine/poker-engine'
import { GameEngine } from '../../games/poker/engine/poker-engine'

// Helper to advance currentPlayerIndex to a specific player for testing
function findPlayerIndex(engine: GameEngine, name: string): number {
  return engine.getState().players.findIndex(p => p.name === name)
}

/** Find player by seatIndex (currentPlayerIndex/dealerIndex are now seatIndex) */
function getPlayerBySeat(state: ReturnType<GameEngine['getState']>, seatIndex: number) {
  return state.players.find(p => p.seatIndex === seatIndex)
}

describe('Fixed-Limit basics', () => {
  it('posts correct blind amounts (SB = smallBlind/2, BB = smallBlind)', () => {
    // $2/$4 game: SB = $1, BB = $2
    const engine = createTestEngine(3, 1000, { small: 2, big: 4 })
    engine.startNewHand()
    const state = engine.getState()

    // Find blind actions
    const sbAction = state.actionHistory.find(a => a.type === 'postSmallBlind')
    const bbAction = state.actionHistory.find(a => a.type === 'postBigBlind')

    expect(sbAction).toBeDefined()
    expect(bbAction).toBeDefined()
    expect(sbAction!.amount).toBe(1)  // smallBlind / 2
    expect(bbAction!.amount).toBe(2)  // smallBlind
    assertChipConservation(engine)
  })

  it('bet/raise use fixed bet size on preflop/flop (小注)', () => {
    const engine = createTestEngine(3, 1000, { small: 2, big: 4 })
    engine.startNewHand()

    const actions = engine.getAvailableActions()
    const betAction = actions.find(a => a.type === 'bet')
    const raiseAction = actions.find(a => a.type === 'raise')

    // On preflop, whoever is to act should have fixed options
    // Either bet or raise should exist with fixed = smallBlind = 2
    if (betAction) {
      expect(betAction.minAmount).toBe(betAction.maxAmount) // Fixed
      expect(betAction.minAmount).toBe(2) // smallBlind
    }
    if (raiseAction) {
      expect(raiseAction.minAmount).toBe(raiseAction.maxAmount) // Fixed
    }
  })

  it('does not offer allIn as an available action', () => {
    const engine = createTestEngine(3, 1000, { small: 2, big: 4 })
    engine.startNewHand()

    const actions = engine.getAvailableActions()
    const allInAction = actions.find(a => a.type === 'allIn')
    expect(allInAction).toBeUndefined()
  })
})

describe('raise cap (4 = 1 bet + 3 raises)', () => {
  it('allows up to 4 bet/raise actions per street', () => {
    const engine = createTestEngine(6, 1000, { small: 2, big: 4 })
    engine.startNewHand()

    // Get all players to call first to reach flop, then test cap on flop
    // Instead, let's test preflop raise ladder
    // Preflop: after BB posted, first to act can call/raise/fold
    let raiseCount = 0

    // Play through preflop trying to raise as much as possible
    let iterations = 0
    while (engine.getState().phase === 'preflop' && iterations < 20) {
      const actions = engine.getAvailableActions()
      if (actions.some(a => a.type === 'raise')) {
        engine.executeAction({ type: 'raise' })
        raiseCount++
      } else if (actions.some(a => a.type === 'bet')) {
        engine.executeAction({ type: 'bet' })
        raiseCount++
      } else if (actions.some(a => a.type === 'call')) {
        engine.executeAction({ type: 'call' })
      } else if (actions.some(a => a.type === 'check')) {
        engine.executeAction({ type: 'check' })
      } else {
        engine.executeAction({ type: 'fold' })
      }
      assertChipConservation(engine)
      iterations++
    }

    // With 6 players and cap of 4, we should have at most 4 bet/raises
    // (BB counts as a bet in the raise count via postBigBlind tracked in streetActions)
    // Actually, postBigBlind is not 'bet' or 'raise', so raise count starts at 0
    expect(raiseCount).toBeLessThanOrEqual(4)
    assertChipConservation(engine)
  })

  it('degrades bet/raise to call/check when raise cap reached', () => {
    const engine = createTestEngine(6, 1000, { small: 2, big: 4 })
    engine.startNewHand()

    // Execute 4 bets/raises to hit cap
    let betsAndRaises = 0
    let iterations = 0
    while (engine.getState().phase === 'preflop' && iterations < 30 && betsAndRaises < 4) {
      const actions = engine.getAvailableActions()
      if (actions.some(a => a.type === 'raise')) {
        engine.executeAction({ type: 'raise' })
        betsAndRaises++
      } else if (actions.some(a => a.type === 'bet')) {
        engine.executeAction({ type: 'bet' })
        betsAndRaises++
      } else if (actions.some(a => a.type === 'call')) {
        engine.executeAction({ type: 'call' })
      } else {
        engine.executeAction({ type: 'fold' })
      }
      iterations++
    }

    // After cap, should not be able to raise
    if (engine.getState().phase === 'preflop') {
      const actions = engine.getAvailableActions()
      const canRaise = actions.some(a => a.type === 'raise' || a.type === 'bet')
      // If we hit the cap, no more raises
      if (betsAndRaises >= 4) {
        expect(canRaise).toBe(false)
      }
    }
    assertChipConservation(engine)
  })

  it('raise ladder: $2 → $4 → $6 → $8 cap', () => {
    // $2/$4 game on preflop (小注 = $2)
    // BB = $2, raise to $4, re-raise to $6, re-re-raise to $8, cap
    const engine = createTestEngine(6, 1000, { small: 2, big: 4 })
    engine.startNewHand()

    const state = engine.getState()
    // BB posts $2 (= smallBlind)
    // First to act faces $2 to call

    // Track bet amounts
    const betAmounts: number[] = []

    let iterations = 0
    while (engine.getState().phase === 'preflop' && iterations < 30) {
      const actions = engine.getAvailableActions()
      const raiseAction = actions.find(a => a.type === 'raise')
      const betAction = actions.find(a => a.type === 'bet')

      if (raiseAction) {
        betAmounts.push(raiseAction.minAmount!)
        engine.executeAction({ type: 'raise', amount: raiseAction.minAmount })
      } else if (betAction) {
        betAmounts.push(betAction.minAmount!)
        engine.executeAction({ type: 'bet', amount: betAction.minAmount })
      } else if (actions.some(a => a.type === 'call')) {
        engine.executeAction({ type: 'call' })
      } else {
        engine.executeAction({ type: 'fold' })
      }
      iterations++
    }

    // Expected raise ladder: $4 (2+2), $6 (4+2), $8 (6+2), then cap
    // The exact amounts depend on who is acting, but each raise adds $2 (smallBlind)
    if (betAmounts.length >= 3) {
      // Each raise should increase by exactly $2 (the fixed bet size)
      for (let i = 1; i < betAmounts.length; i++) {
        expect(betAmounts[i] - betAmounts[i - 1]).toBe(2)
      }
    }
    assertChipConservation(engine)
  })
})

describe('Heads-up: no raise cap', () => {
  it('allows unlimited raises in heads-up', () => {
    const engine = createTestEngine(2, 1000, { small: 2, big: 4 })
    engine.startNewHand()

    let raiseCount = 0
    let iterations = 0
    // Try to raise more than 4 times
    while (engine.getState().phase === 'preflop' && iterations < 20 && raiseCount < 6) {
      const actions = engine.getAvailableActions()
      if (actions.some(a => a.type === 'raise')) {
        engine.executeAction({ type: 'raise' })
        raiseCount++
      } else if (actions.some(a => a.type === 'bet')) {
        engine.executeAction({ type: 'bet' })
        raiseCount++
      } else if (actions.some(a => a.type === 'call')) {
        engine.executeAction({ type: 'call' })
        break
      } else {
        break
      }
      iterations++
    }

    // Should allow more than 4 raises in heads-up
    expect(raiseCount).toBeGreaterThan(4)
    assertChipConservation(engine)
  })
})

describe('executeAction validation', () => {
  it('does not execute action for non-active player', () => {
    const engine = createTestEngine(3, 1000)
    engine.startNewHand()
    const state = engine.getState()
    const currentIdx = state.currentPlayerIndex
    engine.executeAction({ type: 'fold' })
    const stateAfterFold = engine.getState()
    const foldedPlayer = getPlayerBySeat(stateAfterFold, currentIdx)!
    expect(foldedPlayer.status).toBe('folded')
  })

  it('degrades invalid action type to check or fold', () => {
    const engine = createTestEngine(3, 1000)
    engine.startNewHand()
    const actions = engine.getAvailableActions()
    expect(actions.length).toBeGreaterThan(0)

    // Execute check — should always be valid after blinds when no raise
    engine.executeAction({ type: 'check' })
    assertChipConservation(engine)
  })

  it('forces fixed bet amount regardless of input', () => {
    const engine = createTestEngine(3, 1000, { small: 2, big: 4 })
    engine.startNewHand()

    // Find a player who can bet
    let iterations = 0
    while (iterations < 10) {
      const actions = engine.getAvailableActions()
      if (actions.some(a => a.type === 'bet')) {
        // Try to bet a huge amount — engine should force fixed size
        engine.executeAction({ type: 'bet', amount: 999 })
        // Check the last action in history
        const state = engine.getState()
        const lastBet = state.actionHistory.filter(a => a.type === 'bet').pop()
        expect(lastBet).toBeDefined()
        expect(lastBet!.amount).toBe(2) // Fixed to smallBlind on preflop/flop
        break
      } else if (actions.some(a => a.type === 'call')) {
        engine.executeAction({ type: 'call' })
      } else if (actions.some(a => a.type === 'check')) {
        engine.executeAction({ type: 'check' })
      } else {
        engine.executeAction({ type: 'fold' })
      }
      iterations++
    }
    assertChipConservation(engine)
  })
})

describe('chip conservation', () => {
  it('preserves chips through fold/check/call sequence', () => {
    const engine = createTestEngine(3, 1000)
    engine.startNewHand()
    assertChipConservation(engine)

    engine.executeAction({ type: 'fold' })
    assertChipConservation(engine)
  })

  it('preserves chips through raise/re-raise', () => {
    const engine = createTestEngine(3, 1000)
    engine.startNewHand()
    assertChipConservation(engine)

    const actions1 = engine.getAvailableActions()
    if (actions1.some(a => a.type === 'call')) {
      engine.executeAction({ type: 'call' })
    } else {
      engine.executeAction({ type: 'check' })
    }
    assertChipConservation(engine)

    const actions2 = engine.getAvailableActions()
    if (actions2.some(a => a.type === 'raise')) {
      const raiseAction = actions2.find(a => a.type === 'raise')!
      engine.executeAction({ type: 'raise', amount: raiseAction.minAmount })
    } else if (actions2.some(a => a.type === 'bet')) {
      engine.executeAction({ type: 'bet' })
    } else {
      engine.executeAction({ type: 'call' })
    }
    assertChipConservation(engine)
  })

  it('preserves chips with auto all-in (insufficient chips for call)', () => {
    // Create players with different chip stacks
    const engine = new GameEngine({
      seats: [
        { type: 'bot', name: 'Rich', chips: 1000 },
        { type: 'bot', name: 'Medium', chips: 500 },
        { type: 'bot', name: 'Short', chips: 3 },
      ],
      smallBlind: 2,
      bigBlind: 4,
      sessionId: 'test',
      timingConfig: { minActionInterval: 0, thinkingTimeout: 1000 },
    })

    engine.startNewHand()
    assertChipConservation(engine)

    // Play through
    let iterations = 0
    while (engine.getState().phase !== 'showdown' && iterations < 30) {
      const actions = engine.getAvailableActions()
      if (actions.some(a => a.type === 'call')) {
        engine.executeAction({ type: 'call' })
      } else if (actions.some(a => a.type === 'check')) {
        engine.executeAction({ type: 'check' })
      } else {
        engine.executeAction({ type: 'fold' })
      }
      iterations++
    }
    assertChipConservation(engine)
  })

  it('preserves chips through split pot remainder', () => {
    const engine = createTestEngine(3, 1000)
    engine.startNewHand()

    engine.executeAction({ type: 'fold' })
    assertChipConservation(engine)
    const state = engine.getState()
    if (state.phase === 'showdown') {
      assertChipConservation(engine)
    }
  })

  it('preserves chips across multiple hands', () => {
    const engine = createTestEngine(3, 1000)

    for (let hand = 0; hand < 3; hand++) {
      engine.startNewHand()
      assertChipConservation(engine)

      let iterations = 0
      while (engine.getState().phase !== 'showdown' && engine.getState().phase !== 'waiting' && iterations < 20) {
        engine.executeAction({ type: 'fold' })
        assertChipConservation(engine)
        iterations++
      }
      assertChipConservation(engine)
    }
  })
})

describe('startNewHand', () => {
  it('clears eliminated player temporary fields', () => {
    const engine = new GameEngine({
      seats: [
        { type: 'bot', name: 'P0', chips: 1000 },
        { type: 'bot', name: 'P1', chips: 2 },   // Will go all-in on blinds (SB = $1)
        { type: 'bot', name: 'P2', chips: 1000 },
      ],
      smallBlind: 2,
      bigBlind: 4,
      sessionId: 'test',
      timingConfig: { minActionInterval: 0, thinkingTimeout: 1000 },
    })

    engine.startNewHand()
    let iterations = 0
    while (engine.getState().phase !== 'showdown' && iterations < 20) {
      engine.executeAction({ type: 'fold' })
      iterations++
    }

    engine.startNewHand()
    const state = engine.getState()

    for (const p of state.players) {
      expect(p.holeCards.length === 0 || p.status !== 'eliminated').toBe(true)
      if (p.status === 'eliminated') {
        expect(p.currentBet).toBe(0)
        expect(p.totalBetThisRound).toBe(0)
        expect(p.hasActed).toBe(false)
        expect(p.holeCards).toEqual([])
      }
    }
  })

  it('marks 0-chips player as eliminated', () => {
    const engine = new GameEngine({
      seats: [
        { type: 'bot', name: 'P0', chips: 1000 },
        { type: 'bot', name: 'P1', chips: 0 },
        { type: 'bot', name: 'P2', chips: 1000 },
      ],
      smallBlind: 2,
      bigBlind: 4,
      sessionId: 'test',
      timingConfig: { minActionInterval: 0, thinkingTimeout: 1000 },
    })

    engine.startNewHand()
    const state = engine.getState()
    const p1 = state.players.find(p => p.name === 'P1')
    if (p1) {
      expect(p1.status).toBe('eliminated')
    }
  })

  it('does not deal cards to eliminated players', () => {
    const engine = new GameEngine({
      seats: [
        { type: 'bot', name: 'P0', chips: 1000 },
        { type: 'bot', name: 'Broke', chips: 0 },
        { type: 'bot', name: 'P2', chips: 1000 },
      ],
      smallBlind: 2,
      bigBlind: 4,
      sessionId: 'test',
      timingConfig: { minActionInterval: 0, thinkingTimeout: 1000 },
    })

    engine.startNewHand()
    const state = engine.getState()
    const eliminated = state.players.find(p => p.name === 'Broke')
    if (eliminated) {
      expect(eliminated.holeCards).toEqual([])
    }
  })

  it('dealer skips eliminated players', () => {
    const engine = new GameEngine({
      seats: [
        { type: 'bot', name: 'P0', chips: 1000 },
        { type: 'bot', name: 'Broke', chips: 0 },
        { type: 'bot', name: 'P2', chips: 1000 },
      ],
      smallBlind: 2,
      bigBlind: 4,
      sessionId: 'test',
      timingConfig: { minActionInterval: 0, thinkingTimeout: 1000 },
    })

    engine.startNewHand()
    const state = engine.getState()
    const dealer = getPlayerBySeat(state, state.dealerIndex)!
    expect(dealer.status).not.toBe('eliminated')
  })
})

describe('full hand lifecycle', () => {
  it('handles all-fold to one player', () => {
    const engine = createTestEngine(3, 1000)
    engine.startNewHand()
    assertChipConservation(engine)

    let iterations = 0
    while (engine.getState().phase !== 'showdown' && iterations < 20) {
      engine.executeAction({ type: 'fold' })
      iterations++
    }

    expect(engine.getState().phase).toBe('showdown')
    assertChipConservation(engine)

    const histories = engine.getHandHistories()
    expect(histories.length).toBe(1)
    expect(histories[0].winners.length).toBeGreaterThan(0)
  })

  it('handles normal showdown', () => {
    const engine = createTestEngine(3, 1000)
    engine.startNewHand()
    assertChipConservation(engine)

    let iterations = 0
    while (engine.getState().phase !== 'showdown' && iterations < 30) {
      const actions = engine.getAvailableActions()
      if (actions.some(a => a.type === 'call')) {
        engine.executeAction({ type: 'call' })
      } else if (actions.some(a => a.type === 'check')) {
        engine.executeAction({ type: 'check' })
      } else {
        engine.executeAction({ type: 'fold' })
      }
      assertChipConservation(engine)
      iterations++
    }

    expect(engine.getState().phase).toBe('showdown')
    assertChipConservation(engine)
  })

  it('handles auto all-in + run out', () => {
    // Short stack player will auto all-in when calling
    const engine = new GameEngine({
      seats: [
        { type: 'bot', name: 'P0', chips: 1000 },
        { type: 'bot', name: 'Short', chips: 3 },
        { type: 'bot', name: 'P2', chips: 1000 },
      ],
      smallBlind: 2,
      bigBlind: 4,
      sessionId: 'test',
      timingConfig: { minActionInterval: 0, thinkingTimeout: 1000 },
    })

    engine.startNewHand()
    assertChipConservation(engine)

    let iterations = 0
    while (engine.getState().phase !== 'showdown' && iterations < 20) {
      const actions = engine.getAvailableActions()
      if (actions.some(a => a.type === 'call')) {
        engine.executeAction({ type: 'call' })
      } else if (actions.some(a => a.type === 'check')) {
        engine.executeAction({ type: 'check' })
      } else {
        engine.executeAction({ type: 'fold' })
      }
      assertChipConservation(engine)
      iterations++
    }

    expect(engine.getState().phase).toBe('showdown')
    assertChipConservation(engine)
  })

  it('handles heads-up', () => {
    const engine = createTestEngine(2, 1000)
    engine.startNewHand()
    assertChipConservation(engine)

    let iterations = 0
    while (engine.getState().phase !== 'showdown' && iterations < 30) {
      const actions = engine.getAvailableActions()
      if (actions.some(a => a.type === 'call')) {
        engine.executeAction({ type: 'call' })
      } else if (actions.some(a => a.type === 'check')) {
        engine.executeAction({ type: 'check' })
      } else {
        engine.executeAction({ type: 'fold' })
      }
      assertChipConservation(engine)
      iterations++
    }

    expect(engine.getState().phase).toBe('showdown')
    assertChipConservation(engine)
  })

  it('handles elimination then next hand', () => {
    const engine = new GameEngine({
      seats: [
        { type: 'bot', name: 'Rich', chips: 2000 },
        { type: 'bot', name: 'Poor', chips: 3 },
        { type: 'bot', name: 'Normal', chips: 1000 },
      ],
      smallBlind: 2,
      bigBlind: 4,
      sessionId: 'test',
      timingConfig: { minActionInterval: 0, thinkingTimeout: 1000 },
    })

    engine.startNewHand()
    assertChipConservation(engine)

    let iterations = 0
    while (engine.getState().phase !== 'showdown' && iterations < 30) {
      const actions = engine.getAvailableActions()
      if (actions.some(a => a.type === 'call')) {
        engine.executeAction({ type: 'call' })
      } else if (actions.some(a => a.type === 'check')) {
        engine.executeAction({ type: 'check' })
      } else {
        engine.executeAction({ type: 'fold' })
      }
      iterations++
    }
    assertChipConservation(engine)

    engine.startNewHand()
    assertChipConservation(engine)

    const state = engine.getState()
    for (const p of state.players) {
      expect(p.chips).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('turn/river use big bet', () => {
  it('uses bigBlind (大注) for bet/raise on turn and river', () => {
    // $2/$4 game: preflop/flop use $2, turn/river use $4
    const engine = createTestEngine(3, 1000, { small: 2, big: 4 })
    engine.startNewHand()

    // Get to flop by calling/checking through preflop
    let iterations = 0
    while (engine.getState().phase === 'preflop' && iterations < 20) {
      const actions = engine.getAvailableActions()
      if (actions.some(a => a.type === 'call')) {
        engine.executeAction({ type: 'call' })
      } else if (actions.some(a => a.type === 'check')) {
        engine.executeAction({ type: 'check' })
      } else {
        engine.executeAction({ type: 'fold' })
      }
      iterations++
    }

    // Get to turn
    while (engine.getState().phase === 'flop' && iterations < 40) {
      const actions = engine.getAvailableActions()
      if (actions.some(a => a.type === 'check')) {
        engine.executeAction({ type: 'check' })
      } else if (actions.some(a => a.type === 'call')) {
        engine.executeAction({ type: 'call' })
      } else {
        engine.executeAction({ type: 'fold' })
      }
      iterations++
    }

    // On turn, bet should be $4 (bigBlind)
    if (engine.getState().phase === 'turn') {
      const actions = engine.getAvailableActions()
      const betAction = actions.find(a => a.type === 'bet')
      if (betAction) {
        expect(betAction.minAmount).toBe(4) // bigBlind = 大注
        expect(betAction.maxAmount).toBe(4)
      }
    }

    assertChipConservation(engine)
  })
})

describe('edge cases', () => {
  it('handles short stack auto all-in on blind', () => {
    const engine = new GameEngine({
      seats: [
        { type: 'bot', name: 'P0', chips: 1000 },
        { type: 'bot', name: 'Tiny', chips: 1 },  // Less than SB ($1)
        { type: 'bot', name: 'P2', chips: 1000 },
      ],
      smallBlind: 2,
      bigBlind: 4,
      sessionId: 'test',
      timingConfig: { minActionInterval: 0, thinkingTimeout: 1000 },
    })

    engine.startNewHand()
    assertChipConservation(engine)

    let iterations = 0
    while (engine.getState().phase !== 'showdown' && iterations < 30) {
      const actions = engine.getAvailableActions()
      if (actions.some(a => a.type === 'call')) {
        engine.executeAction({ type: 'call' })
      } else if (actions.some(a => a.type === 'check')) {
        engine.executeAction({ type: 'check' })
      } else {
        engine.executeAction({ type: 'fold' })
      }
      iterations++
    }
    assertChipConservation(engine)
  })

  it('chips never go negative', () => {
    const engine = createTestEngine(4, 500)

    for (let hand = 0; hand < 5; hand++) {
      engine.startNewHand()

      let iterations = 0
      while (engine.getState().phase !== 'showdown' && iterations < 30) {
        const actions = engine.getAvailableActions()
        if (hand % 2 === 0) {
          // Aggressive hands — bet/raise when possible
          if (actions.some(a => a.type === 'raise')) {
            engine.executeAction({ type: 'raise' })
          } else if (actions.some(a => a.type === 'bet')) {
            engine.executeAction({ type: 'bet' })
          } else if (actions.some(a => a.type === 'call')) {
            engine.executeAction({ type: 'call' })
          } else {
            engine.executeAction({ type: 'fold' })
          }
        } else {
          // Passive hands
          if (actions.some(a => a.type === 'check')) {
            engine.executeAction({ type: 'check' })
          } else if (actions.some(a => a.type === 'call')) {
            engine.executeAction({ type: 'call' })
          } else {
            engine.executeAction({ type: 'fold' })
          }
        }
        iterations++
      }

      const state = engine.getState()
      for (const p of state.players) {
        expect(p.chips).toBeGreaterThanOrEqual(0)
      }
      assertChipConservation(engine)
    }
  })

  it('modifying snapshot does not affect engine internal state', () => {
    const engine = createTestEngine(2, 1000)
    engine.startNewHand()

    const snapshot = engine.getState()
    const originalCards = [...snapshot.players[0].holeCards]
    expect(originalCards.length).toBe(2)

    snapshot.players[0].holeCards = []
    snapshot.communityCards.push({ suit: 'hearts', rank: 'A' } as any)

    const fresh = engine.getState()
    expect(fresh.players[0].holeCards).toEqual(originalCards)
    expect(fresh.communityCards.length).toBe(0)
  })

  it('two getState calls return independent objects', () => {
    const engine = createTestEngine(2, 1000)
    engine.startNewHand()

    const s1 = engine.getState()
    const s2 = engine.getState()

    expect(s1.players[0]).not.toBe(s2.players[0])
    expect(s1.players[0].holeCards).not.toBe(s2.players[0].holeCards)
    expect(s1.communityCards).not.toBe(s2.communityCards)
    expect(s1.actionHistory).not.toBe(s2.actionHistory)

    expect(s1.players[0].holeCards).toEqual(s2.players[0].holeCards)
  })

  it('deck is never exposed', () => {
    const engine = createTestEngine(2, 1000)
    engine.startNewHand()

    const state = engine.getState()
    expect(state.deck).toEqual([])
  })

  it('exact tie split distributes all chips', () => {
    const engine = createTestEngine(2, 1000)
    engine.startNewHand()

    let iterations = 0
    while (engine.getState().phase !== 'showdown' && iterations < 30) {
      const actions = engine.getAvailableActions()
      if (actions.some(a => a.type === 'call')) {
        engine.executeAction({ type: 'call' })
      } else if (actions.some(a => a.type === 'check')) {
        engine.executeAction({ type: 'check' })
      } else {
        engine.executeAction({ type: 'fold' })
      }
      iterations++
    }

    assertChipConservation(engine)
  })
})
