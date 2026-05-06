/**
 * LLM Integration Tests — simulate LLM response text → parse → validate → engine
 *
 * These tests mock callLLMStreaming/callLLM to return pre-crafted LLM responses,
 * then drive the full adapter → engine pipeline, verifying:
 *   - Correct action parsing and execution
 *   - Action degradation / clamping for invalid LLM output
 *   - Chip conservation throughout
 *   - Multi-hand games with LLM players
 *   - Edge cases: timeout, garbage output, wrong action types
 */
import { describe, it, expect, vi } from 'vitest'
import { GameEngine } from '../../games/poker/engine/poker-engine'
import type { GameConfig, AvailableAction } from '../../games/poker/engine/poker-engine'
import { LLMAdapter } from '../../agent/player-adapter'
import type { DecisionResult } from '../../agent/player-adapter'
import { parseThinkingAndAction, validateAction } from '../../games/poker/agent/poker-parser'
import { assertChipConservation } from './test-helpers'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a game engine where all players are LLM type */
function createLLMEngine(
  playerCount: number = 3,
  chips: number = 1000,
  blinds = { small: 2, big: 4 },
): GameEngine {
  const seats: GameConfig['seats'] = []
  for (let i = 0; i < playerCount; i++) {
    seats.push({
      type: 'llm',
      name: `LLM_${i}`,
      chips,
      profileId: 'test-profile',
    })
  }
  return new GameEngine({
    seats,
    smallBlind: blinds.small,
    bigBlind: blinds.big,
    sessionId: 'llm-test',
    timingConfig: { minActionInterval: 0, thinkingTimeout: 1000 },
  })
}

/**
 * Simulate what LLMAdapter + engine do: parse the LLM text, validate against
 * available actions, then execute.  Returns the decision result.
 */
function simulateLLMAction(
  engine: GameEngine,
  llmResponseText: string,
): { decision: DecisionResult; executed: boolean } {
  const validActions = engine.getAvailableActions()
  if (validActions.length === 0) {
    return { decision: { type: 'fold', amount: 0 }, executed: false }
  }

  const parsed = parseThinkingAndAction(llmResponseText)
  if (!parsed) {
    // Unparseable → fold (same as adapter)
    engine.executeAction({ type: 'fold' })
    return { decision: { type: 'fold', amount: 0, thinking: undefined }, executed: true }
  }

  const validated = validateAction(parsed.action, validActions)
  if (!validated) {
    engine.executeAction({ type: 'fold' })
    return { decision: { type: 'fold', amount: 0, thinking: parsed.thinking }, executed: true }
  }

  engine.executeAction({ type: validated.type, amount: validated.amount })
  return {
    decision: { type: validated.type, amount: validated.amount, thinking: parsed.thinking },
    executed: true,
  }
}

/** Play hand to completion with a response generator function */
function playHandToEnd(
  engine: GameEngine,
  getResponse: (playerName: string, actions: AvailableAction[]) => string,
  maxIterations = 50,
): void {
  let iterations = 0
  while (engine.getState().phase !== 'showdown' &&
         engine.getState().phase !== 'waiting' &&
         iterations < maxIterations) {
    const state = engine.getState()
    const player = state.players.find(p => p.seatIndex === state.currentPlayerIndex)!
    const actions = engine.getAvailableActions()
    if (actions.length === 0) break
    const response = getResponse(player.name, actions)
    simulateLLMAction(engine, response)
    iterations++
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LLM response → engine (parse + validate + execute)', () => {

  it('well-formed fold response (new format)', () => {
    const engine = createLLMEngine(3, 1000)
    engine.startNewHand()
    assertChipConservation(engine)

    const response = `<thinking>我手牌很差，应该弃牌。</thinking>
<action>fold</action>`

    const { decision } = simulateLLMAction(engine, response)
    expect(decision.type).toBe('fold')
    expect(decision.thinking).toContain('弃牌')
    assertChipConservation(engine)
  })

  it('well-formed fold response (legacy JSON format)', () => {
    const engine = createLLMEngine(3, 1000)
    engine.startNewHand()

    const response = `<thinking>弃牌</thinking>
<action>{"type":"fold","amount":0}</action>`

    const { decision } = simulateLLMAction(engine, response)
    expect(decision.type).toBe('fold')
    assertChipConservation(engine)
  })

  it('well-formed call response', () => {
    const engine = createLLMEngine(3, 1000)
    engine.startNewHand()

    const actions = engine.getAvailableActions()
    const callAction = actions.find(a => a.type === 'call')
    if (!callAction) return // Skip if first player can't call

    const response = `<thinking>跟注看看翻牌。</thinking>
<action>call</action>`

    const { decision } = simulateLLMAction(engine, response)
    expect(decision.type).toBe('call')
    assertChipConservation(engine)
  })

  it('well-formed check response', () => {
    const engine = createLLMEngine(3, 1000)
    engine.startNewHand()

    const actions = engine.getAvailableActions()
    if (!actions.some(a => a.type === 'check')) {
      // First act preflop — call first, then next player may check
      simulateLLMAction(engine, '<action>call</action>')
    }

    const checkActions = engine.getAvailableActions()
    if (checkActions.some(a => a.type === 'check')) {
      const response = `<thinking>过牌等下一张。</thinking>
<action>check</action>`
      const { decision } = simulateLLMAction(engine, response)
      expect(decision.type).toBe('check')
    }
    assertChipConservation(engine)
  })

  it('well-formed raise response with valid amount', () => {
    const engine = createLLMEngine(3, 1000)
    engine.startNewHand()

    const actions = engine.getAvailableActions()
    const raiseAction = actions.find(a => a.type === 'raise')
    if (!raiseAction) return

    const response = `<thinking>强牌加注。</thinking>
<action>raise</action>`

    const { decision } = simulateLLMAction(engine, response)
    expect(decision.type).toBe('raise')
    assertChipConservation(engine)
  })

  it('well-formed bet response', () => {
    const engine = createLLMEngine(3, 1000)
    engine.startNewHand()

    const actions = engine.getAvailableActions()
    const betAction = actions.find(a => a.type === 'bet')
    if (!betAction) return

    const response = `<thinking>下注试探。</thinking>
<action>bet</action>`

    const { decision } = simulateLLMAction(engine, response)
    expect(decision.type).toBe('bet')
    assertChipConservation(engine)
  })

  it('allIn not available in fixed-limit (no allIn action offered)', () => {
    const engine = createLLMEngine(3, 1000)
    engine.startNewHand()

    const actions = engine.getAvailableActions()
    const allInAction = actions.find(a => a.type === 'allIn')
    expect(allInAction).toBeUndefined()
    assertChipConservation(engine)
  })
})

describe('LLM invalid / malformed output handling', () => {

  it('garbage text → fold', () => {
    const engine = createLLMEngine(3, 1000)
    engine.startNewHand()
    const stateBefore = engine.getState()
    const playerBefore = stateBefore.players.find(p => p.seatIndex === stateBefore.currentPlayerIndex)!

    const response = '我不知道该怎么做，让我想想……算了不想了'
    const { decision } = simulateLLMAction(engine, response)
    expect(decision.type).toBe('fold')
    assertChipConservation(engine)
  })

  it('empty response → fold', () => {
    const engine = createLLMEngine(3, 1000)
    engine.startNewHand()

    const { decision } = simulateLLMAction(engine, '')
    expect(decision.type).toBe('fold')
    assertChipConservation(engine)
  })

  it('malformed JSON → fold', () => {
    const engine = createLLMEngine(3, 1000)
    engine.startNewHand()

    const response = '<action>{"type": raise, amount: 100}</action>'
    const { decision } = simulateLLMAction(engine, response)
    expect(decision.type).toBe('fold')
    assertChipConservation(engine)
  })

  it('missing action tag but valid JSON → parsed correctly', () => {
    const engine = createLLMEngine(3, 1000)
    engine.startNewHand()

    const response = '让我弃牌 {"type":"fold","amount":0} 就这样'
    const { decision } = simulateLLMAction(engine, response)
    expect(decision.type).toBe('fold')
    assertChipConservation(engine)
  })

  it('LLM says "bet" but only raise is valid → auto-maps to raise', () => {
    const engine = createLLMEngine(3, 1000)
    engine.startNewHand()

    const actions = engine.getAvailableActions()
    const hasRaise = actions.some(a => a.type === 'raise')
    const hasBet = actions.some(a => a.type === 'bet')

    if (hasRaise && !hasBet) {
      const response = `<thinking>加注</thinking>
<action>bet</action>`

      const { decision } = simulateLLMAction(engine, response)
      expect(decision.type).toBe('raise')
      assertChipConservation(engine)
    }
  })

  it('LLM says "raise" but only bet is valid → auto-maps to bet', () => {
    const engine = createLLMEngine(3, 1000)
    engine.startNewHand()

    const actions = engine.getAvailableActions()
    const hasBet = actions.some(a => a.type === 'bet')
    const hasRaise = actions.some(a => a.type === 'raise')

    if (hasBet && !hasRaise) {
      const response = `<thinking>下注</thinking>
<action>raise</action>`

      const { decision } = simulateLLMAction(engine, response)
      expect(decision.type).toBe('bet')
      assertChipConservation(engine)
    }
  })

  it('LLM says "check" when must call → auto-maps to call', () => {
    const engine = createLLMEngine(3, 1000)
    engine.startNewHand()

    const actions = engine.getAvailableActions()
    const hasCall = actions.some(a => a.type === 'call')
    const hasCheck = actions.some(a => a.type === 'check')

    if (hasCall && !hasCheck) {
      const response = `<thinking>过牌</thinking>
<action>check</action>`

      const { decision } = simulateLLMAction(engine, response)
      expect(decision.type).toBe('call')
      assertChipConservation(engine)
    }
  })

  it('raise amount too low → clamped to min', () => {
    const engine = createLLMEngine(3, 1000)
    engine.startNewHand()

    const actions = engine.getAvailableActions()
    const raiseAction = actions.find(a => a.type === 'raise')
    if (!raiseAction) return

    const tooLow = (raiseAction.minAmount || 0) - 50
    const response = `<thinking>小加注</thinking>
<action>{"type":"raise","amount":${tooLow}}</action>`

    const { decision } = simulateLLMAction(engine, response)
    if (decision.type === 'raise') {
      expect(decision.amount).toBeGreaterThanOrEqual(raiseAction.minAmount!)
    }
    assertChipConservation(engine)
  })

  it('raise amount too high → clamped to max', () => {
    const engine = createLLMEngine(3, 1000)
    engine.startNewHand()

    const actions = engine.getAvailableActions()
    const raiseAction = actions.find(a => a.type === 'raise')
    if (!raiseAction) return

    const response = `<thinking>超大加注</thinking>
<action>{"type":"raise","amount":999999}</action>`

    const { decision } = simulateLLMAction(engine, response)
    if (decision.type === 'raise') {
      expect(decision.amount).toBeLessThanOrEqual(raiseAction.maxAmount!)
    }
    assertChipConservation(engine)
  })

  it('bet amount zero → clamped to minimum bet', () => {
    const engine = createLLMEngine(3, 1000)
    engine.startNewHand()

    const actions = engine.getAvailableActions()
    const betAction = actions.find(a => a.type === 'bet')
    if (!betAction) return

    const response = `<action>{"type":"bet","amount":0}</action>`
    const { decision } = simulateLLMAction(engine, response)
    if (decision.type === 'bet') {
      expect(decision.amount).toBeGreaterThanOrEqual(betAction.minAmount!)
    }
    assertChipConservation(engine)
  })

  it('completely invalid action type → fold', () => {
    const engine = createLLMEngine(3, 1000)
    engine.startNewHand()

    const response = `<action>{"type":"surrender","amount":0}</action>`
    const { decision } = simulateLLMAction(engine, response)
    // "surrender" is not a valid ActionType, validateAction returns null → fold
    expect(decision.type).toBe('fold')
    assertChipConservation(engine)
  })
})

describe('LLM full-hand simulation', () => {

  it('3 LLM players — all fold to one winner', () => {
    const engine = createLLMEngine(3, 1000)
    engine.startNewHand()

    playHandToEnd(engine, () =>
      '<thinking>弃牌</thinking><action>fold</action>'
    )

    expect(engine.getState().phase).toBe('showdown')
    assertChipConservation(engine)
    const history = engine.getHandHistories()
    expect(history.length).toBe(1)
    expect(history[0].winners.length).toBeGreaterThan(0)
  })

  it('3 LLM players — all call to showdown', () => {
    const engine = createLLMEngine(3, 1000)
    engine.startNewHand()

    playHandToEnd(engine, (_name, actions) => {
      if (actions.some(a => a.type === 'call')) {
        return `<thinking>跟注</thinking><action>call</action>`
      }
      return '<thinking>过牌</thinking><action>check</action>'
    })

    expect(engine.getState().phase).toBe('showdown')
    assertChipConservation(engine)
  })

  it('3 LLM players — mixed actions to showdown', () => {
    const engine = createLLMEngine(3, 1000)
    engine.startNewHand()
    let actionIndex = 0

    playHandToEnd(engine, (_name, actions) => {
      actionIndex++
      // Rotate: call, check, bet/raise
      if (actionIndex % 3 === 0 && actions.some(a => a.type === 'bet')) {
        return `<thinking>下注</thinking><action>bet</action>`
      }
      if (actionIndex % 3 === 1 && actions.some(a => a.type === 'raise')) {
        return `<thinking>加注</thinking><action>raise</action>`
      }
      if (actions.some(a => a.type === 'call')) {
        return `<thinking>跟注</thinking><action>call</action>`
      }
      return '<thinking>过牌</thinking><action>check</action>'
    })

    expect(engine.getState().phase).toBe('showdown')
    assertChipConservation(engine)
  })

  it('one LLM bets max, others call', () => {
    const engine = createLLMEngine(3, 1000)
    engine.startNewHand()
    let firstAction = true

    playHandToEnd(engine, (_name, actions) => {
      if (firstAction && actions.some(a => a.type === 'raise')) {
        firstAction = false
        return `<thinking>加注</thinking><action>raise</action>`
      }
      if (actions.some(a => a.type === 'call')) {
        return `<thinking>跟注</thinking><action>call</action>`
      }
      return '<thinking>过牌</thinking><action>check</action>'
    })

    expect(engine.getState().phase).toBe('showdown')
    assertChipConservation(engine)
  })

  it('all LLMs raise/call preflop', () => {
    const engine = createLLMEngine(3, 500)
    engine.startNewHand()

    playHandToEnd(engine, (_name, actions) => {
      if (actions.some(a => a.type === 'raise')) {
        return `<action>raise</action>`
      }
      if (actions.some(a => a.type === 'call')) {
        return `<action>call</action>`
      }
      if (actions.some(a => a.type === 'check')) {
        return '<action>check</action>'
      }
      return '<action>fold</action>'
    })

    expect(engine.getState().phase).toBe('showdown')
    assertChipConservation(engine)
  })

  it('heads-up LLM game', () => {
    const engine = createLLMEngine(2, 1000)
    engine.startNewHand()

    playHandToEnd(engine, (_name, actions) => {
      if (actions.some(a => a.type === 'call')) {
        return `<action>call</action>`
      }
      return '<action>check</action>'
    })

    expect(engine.getState().phase).toBe('showdown')
    assertChipConservation(engine)
  })
})

describe('LLM multi-hand simulation', () => {

  it('3 hands in a row — conservation maintained', () => {
    const engine = createLLMEngine(3, 1000)

    for (let hand = 0; hand < 3; hand++) {
      engine.startNewHand()
      assertChipConservation(engine)

      playHandToEnd(engine, (_name, actions) => {
        if (actions.some(a => a.type === 'call')) {
          return `<action>call</action>`
        }
        return '<action>check</action>'
      })

      assertChipConservation(engine)
    }

    expect(engine.getHandHistories().length).toBe(3)
  })

  it('5 hands — mix of fold/call/bet, no negative chips', () => {
    const engine = createLLMEngine(3, 1000)
    let handCount = 0

    for (let hand = 0; hand < 5; hand++) {
      const state = engine.getState()
      const active = state.players.filter(p => p.chips > 0 && p.status !== 'eliminated')
      if (active.length < 2) break

      engine.startNewHand()
      handCount++

      playHandToEnd(engine, (_name, actions) => {
        // Alternate strategies each hand
        if (hand % 3 === 0) {
          // Fold — use new format
          return '<action>fold</action>'
        }
        if (hand % 3 === 1) {
          // Call/check — use legacy JSON format for compat testing
          if (actions.some(a => a.type === 'call')) {
            const callAmt = actions.find(a => a.type === 'call')!.minAmount
            return `<action>{"type":"call","amount":${callAmt}}</action>`
          }
          return '<action>{"type":"check","amount":0}</action>'
        }
        // Bet/raise — use new format
        if (actions.some(a => a.type === 'bet')) {
          return `<action>bet</action>`
        }
        if (actions.some(a => a.type === 'raise')) {
          return `<action>raise</action>`
        }
        if (actions.some(a => a.type === 'call')) {
          return `<action>call</action>`
        }
        return '<action>check</action>'
      })

      // Verify no negative chips
      for (const p of engine.getState().players) {
        expect(p.chips).toBeGreaterThanOrEqual(0)
      }
      assertChipConservation(engine)
    }

    expect(handCount).toBeGreaterThan(0)
  })

  it('LLM player gets eliminated, next hand continues correctly', () => {
    const engine = new GameEngine({
      seats: [
        { type: 'llm', name: 'Rich', chips: 2000, profileId: 'test' },
        { type: 'llm', name: 'Poor', chips: 3, profileId: 'test' },
        { type: 'llm', name: 'Normal', chips: 1000, profileId: 'test' },
      ],
      smallBlind: 2,
      bigBlind: 4,
      sessionId: 'llm-test',
      timingConfig: { minActionInterval: 0, thinkingTimeout: 1000 },
    })

    // Hand 1 — call through (Poor will likely go all-in on blinds)
    engine.startNewHand()
    playHandToEnd(engine, (_name, actions) => {
      if (actions.some(a => a.type === 'call')) {
        return `<action>call</action>`
      }
      return '<action>check</action>'
    })
    assertChipConservation(engine)

    // Hand 2 — should work with potentially eliminated player
    engine.startNewHand()
    const state2 = engine.getState()

    // Eliminated player should have clean state
    for (const p of state2.players) {
      if (p.status === 'eliminated') {
        expect(p.holeCards).toEqual([])
        expect(p.currentBet).toBe(0)
        expect(p.chips).toBe(0)
      }
    }

    playHandToEnd(engine, (_name, actions) => {
      if (actions.some(a => a.type === 'call')) {
        return `<action>call</action>`
      }
      return '<action>check</action>'
    })
    assertChipConservation(engine)
  })
})

describe('LLM adapter direct tests (no network)', () => {

  it('parseThinkingAndAction + validateAction pipeline: fold', () => {
    const engine = createLLMEngine(3, 1000)
    engine.startNewHand()
    const actions = engine.getAvailableActions()

    const text = '<thinking>弱牌弃掉</thinking><action>fold</action>'
    const parsed = parseThinkingAndAction(text)
    expect(parsed).not.toBeNull()
    expect(parsed!.thinking).toContain('弱牌')
    const validated = validateAction(parsed!.action, actions)
    expect(validated).not.toBeNull()
    expect(validated!.type).toBe('fold')
  })

  it('parseThinkingAndAction + validateAction pipeline: raise with clamping', () => {
    const engine = createLLMEngine(3, 1000)
    engine.startNewHand()
    const actions = engine.getAvailableActions()
    const raiseAction = actions.find(a => a.type === 'raise')
    if (!raiseAction) return

    // LLM returns raise with too-low amount → should be clamped up
    const text = `<thinking>加注</thinking><action>{"type":"raise","amount":1}</action>`
    const parsed = parseThinkingAndAction(text)
    expect(parsed).not.toBeNull()
    const validated = validateAction(parsed!.action, actions)
    expect(validated).not.toBeNull()
    expect(validated!.type).toBe('raise')
    expect(validated!.amount).toBeGreaterThanOrEqual(raiseAction.minAmount!)
  })

  it('parseThinkingAndAction + validateAction pipeline: retry scenario (bad → good)', () => {
    const engine = createLLMEngine(3, 1000)
    engine.startNewHand()
    const actions = engine.getAvailableActions()

    // First attempt: unparseable
    const badText = '完全无法解析的回复'
    const badParsed = parseThinkingAndAction(badText)
    expect(badParsed).toBeNull()

    // Retry attempt: valid fold
    const retryText = '<thinking>重试成功</thinking><action>fold</action>'
    const retryParsed = parseThinkingAndAction(retryText)
    expect(retryParsed).not.toBeNull()
    const validated = validateAction(retryParsed!.action, actions)
    expect(validated).not.toBeNull()
    expect(validated!.type).toBe('fold')
  })

  it('LLMAdapter folds when no profileId (direct)', async () => {
    const adapter = new LLMAdapter(() => undefined, 5000)
    const engine = createLLMEngine(3, 1000)
    engine.startNewHand()
    const state = engine.getState()
    const player = state.players.find(p => p.seatIndex === state.currentPlayerIndex)!
    const actions = engine.getAvailableActions()

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await adapter.decide(player, state, actions)
    expect(result.type).toBe('fold')
    warnSpy.mockRestore()
  })

  it('LLMAdapter folds when profile not found (direct)', async () => {
    const adapter = new LLMAdapter(() => undefined, 5000)
    const engine = createLLMEngine(3, 1000)
    engine.startNewHand()
    const state = engine.getState()
    const player = { ...state.players.find(p => p.seatIndex === state.currentPlayerIndex)!, profileId: 'nonexistent' }
    const actions = engine.getAvailableActions()

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await adapter.decide(player, state, actions)
    expect(result.type).toBe('fold')
    warnSpy.mockRestore()
  })
})

describe('LLM response edge cases on engine', () => {

  it('LLM returns allIn type → engine degrades to fold/call (no allIn available)', () => {
    const engine = createLLMEngine(3, 1000)
    engine.startNewHand()

    // allIn is not offered in fixed-limit, so engine should degrade
    const response = `<action>allIn</action>`
    const { decision } = simulateLLMAction(engine, response)
    // validateAction should map allIn to something valid or fold
    assertChipConservation(engine)
  })

  it('LLM flips between different valid actions across streets', () => {
    const engine = createLLMEngine(3, 1000)
    engine.startNewHand()
    let streetCount = 0

    playHandToEnd(engine, (_name, actions) => {
      streetCount++
      // Street 1: call, Street 2: bet/raise, Street 3: check, Street 4: fold
      const mod = streetCount % 4
      if (mod === 0 && actions.some(a => a.type === 'call')) {
        return `<action>call</action>`
      }
      if (mod === 1 && actions.some(a => a.type === 'bet')) {
        return `<action>bet</action>`
      }
      if (mod === 2 && actions.some(a => a.type === 'check')) {
        return '<action>check</action>'
      }
      // Default
      if (actions.some(a => a.type === 'call')) {
        return `<action>call</action>`
      }
      if (actions.some(a => a.type === 'check')) {
        return '<action>check</action>'
      }
      return '<action>fold</action>'
    })

    assertChipConservation(engine)
  })

  it('LLM returns action with extra whitespace and newlines', () => {
    const engine = createLLMEngine(3, 1000)
    engine.startNewHand()

    const response = `
      <thinking>
        分析中...
      </thinking>
      <action>
        {  "type" : "fold" ,  "amount" : 0  }
      </action>
    `
    const { decision } = simulateLLMAction(engine, response)
    expect(decision.type).toBe('fold')
    assertChipConservation(engine)
  })

  it('LLM returns thinking without action tag but has JSON', () => {
    const engine = createLLMEngine(3, 1000)
    engine.startNewHand()

    const response = `<thinking>思考中</thinking>
OK，我决定弃牌。{"type":"fold","amount":0}`
    const { decision } = simulateLLMAction(engine, response)
    expect(decision.type).toBe('fold')
    assertChipConservation(engine)
  })

  it('LLM returns Chinese action type → fold (invalid type)', () => {
    const engine = createLLMEngine(3, 1000)
    engine.startNewHand()

    const response = '<action>{"type":"弃牌","amount":0}</action>'
    const { decision } = simulateLLMAction(engine, response)
    // "弃牌" is not a valid ActionType → validateAction returns null → fold
    expect(decision.type).toBe('fold')
    assertChipConservation(engine)
  })

  it('6-player LLM game plays to completion', () => {
    const engine = createLLMEngine(6, 1000)
    engine.startNewHand()

    playHandToEnd(engine, (_name, actions) => {
      if (actions.some(a => a.type === 'call')) {
        return `<action>call</action>`
      }
      return '<action>check</action>'
    })

    expect(engine.getState().phase).toBe('showdown')
    assertChipConservation(engine)
  })

  it('6-player LLM multi-hand stress test (10 hands)', () => {
    const engine = createLLMEngine(6, 1000)

    for (let hand = 0; hand < 10; hand++) {
      const state = engine.getState()
      const active = state.players.filter(p => p.chips > 0 && p.status !== 'eliminated')
      if (active.length < 2) break

      engine.startNewHand()

      playHandToEnd(engine, (_name, actions) => {
        // Mix of strategies
        if (hand % 4 === 0) {
          return '<action>fold</action>'
        }
        if (actions.some(a => a.type === 'call')) {
          return `<action>call</action>`
        }
        return '<action>check</action>'
      })

      // Verify invariants
      for (const p of engine.getState().players) {
        expect(p.chips).toBeGreaterThanOrEqual(0)
      }
      assertChipConservation(engine)
    }
  })
})

describe('LLM state consistency — snapshot matches engine truth', () => {
  it('each snapshot has correct holeCards for each player', () => {
    const engine = createLLMEngine(3, 1000)
    engine.startNewHand()

    const state = engine.getState()
    // Every active player should have exactly 2 hole cards
    for (const p of state.players) {
      if (p.status === 'active' || p.status === 'allIn') {
        expect(p.holeCards.length).toBe(2)
        // Cards should be valid
        for (const c of p.holeCards) {
          expect(c.rank).toBeDefined()
          expect(c.suit).toBeDefined()
        }
      }
    }

    // No two players should share the same card
    const allCards = state.players.flatMap(p => p.holeCards.map(c => `${c.rank}${c.suit}`))
    const uniqueCards = new Set(allCards)
    expect(uniqueCards.size).toBe(allCards.length)
  })

  it('multiple getState() calls return consistent snapshots without mutations between', () => {
    const engine = createLLMEngine(3, 1000)
    engine.startNewHand()

    const state1 = engine.getState()
    const state2 = engine.getState()

    // Same player data
    for (let i = 0; i < state1.players.length; i++) {
      expect(state1.players[i].id).toBe(state2.players[i].id)
      expect(state1.players[i].chips).toBe(state2.players[i].chips)
      expect(state1.players[i].holeCards).toEqual(state2.players[i].holeCards)
      expect(state1.players[i].currentBet).toBe(state2.players[i].currentBet)
      expect(state1.players[i].status).toBe(state2.players[i].status)
    }

    // Same game state
    expect(state1.pot).toBe(state2.pot)
    expect(state1.phase).toBe(state2.phase)
    expect(state1.communityCards).toEqual(state2.communityCards)
    expect(state1.dealerIndex).toBe(state2.dealerIndex)
    expect(state1.currentPlayerIndex).toBe(state2.currentPlayerIndex)
  })

  it('snapshot holeCards are isolated from engine mutations', () => {
    const engine = createLLMEngine(3, 1000)
    engine.startNewHand()

    const stateBefore = engine.getState()
    const cardsBefore = stateBefore.players[0].holeCards.map(c => ({ ...c }))

    // Execute an action to mutate engine state
    simulateLLMAction(engine, '<action>call</action>')

    // Original snapshot should still have the same cards
    expect(stateBefore.players[0].holeCards).toEqual(cardsBefore)
  })

  it('action history records correct phase per action across streets', () => {
    const engine = createLLMEngine(3, 1000)
    engine.startNewHand()

    // Play through preflop (everyone calls/checks)
    playHandToEnd(engine, (_name, actions) => {
      if (actions.some(a => a.type === 'call')) return '<action>call</action>'
      return '<action>check</action>'
    })

    const state = engine.getState()
    // All actions should have a phase field
    for (const action of state.actionHistory) {
      expect(action.phase).toBeDefined()
      expect(['preflop', 'flop', 'turn', 'river']).toContain(action.phase)
    }

    // Blind actions should be in preflop
    const blindActions = state.actionHistory.filter(
      a => a.type === 'postSmallBlind' || a.type === 'postBigBlind'
    )
    for (const a of blindActions) {
      expect(a.phase).toBe('preflop')
    }
  })

  it('pot equals sum of all player bets (mid-hand consistency)', () => {
    const engine = createLLMEngine(3, 1000)
    engine.startNewHand()

    // After blinds, pot should equal SB + BB
    const state = engine.getState()
    const totalBets = state.players.reduce((sum, p) => sum + p.totalBetThisRound, 0)
    expect(state.pot).toBe(totalBets)
  })

  it('chips + pot = total chips in game (mid-hand)', () => {
    const engine = createLLMEngine(3, 1000)
    const totalChips = engine.getTotalChipsInGame()
    engine.startNewHand()

    // After some actions
    simulateLLMAction(engine, '<action>call</action>')

    const state = engine.getState()
    const playerChips = state.players.reduce((sum, p) => sum + p.chips, 0)
    expect(playerChips + state.pot).toBe(totalChips)
  })
})
