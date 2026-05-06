import { describe, expect, it } from 'vitest'
import { PokerEngine } from '../../engine/poker-engine'
import type { PokerConfig } from '../../engine/poker-types'
import { PokerBotStrategy } from '../bot-strategy'

const config: PokerConfig = {
  smallBlind: 2,
  bigBlind: 4,
  startingChips: 200,
  maxBetsPerStreet: 4,
}

describe('PokerBotStrategy', () => {
  it('always returns an action from validActions set', () => {
    const engine = new PokerEngine()
    const state = engine.createInitialState(config, ['a', 'b', 'c', 'd', 'e', 'f'])
    const actor = engine.currentActor(state)
    expect(actor).not.toBeNull()

    const validActions = engine.availableActions(state, actor!)
    const action = new PokerBotStrategy(() => 0.5).decide(state, validActions)

    expect(validActions.some((validAction) => validAction.type === action.type)).toBe(true)
  })

  it('finishes a hand when applied in loop', () => {
    const engine = new PokerEngine()
    const bot = new PokerBotStrategy(() => 0.9)
    let state = engine.createInitialState(config, ['a', 'b', 'c', 'd', 'e', 'f'])
    let guard = 200

    while (!state.handComplete && guard-- > 0) {
      const actor = engine.currentActor(state)
      if (!actor) break
      const validActions = engine.availableActions(state, actor)
      const action = bot.decide(state, validActions)
      state = engine.applyAction(state, actor, action).nextState
    }

    expect(state.handComplete).toBe(true)
  })
})
