import { describe, expect, it } from 'vitest'
import { PokerEngine } from '../poker-engine'
import type { PokerConfig } from '../poker-types'

const defaultConfig: PokerConfig = {
  smallBlind: 2,
  bigBlind: 4,
  startingChips: 200,
  maxBetsPerStreet: 4,
}

describe('PokerEngine.createInitialState', () => {
  it('6 players seeded with blinds', () => {
    const engine = new PokerEngine()
    const state = engine.createInitialState(defaultConfig, ['a', 'b', 'c', 'd', 'e', 'f'])

    expect(state.players.length).toBe(6)
    expect(state.players.find((player) => player.currentBet === 2)).toBeDefined()
    expect(state.players.find((player) => player.currentBet === 4)).toBeDefined()
    expect(state.phase).toBe('preflop')
    expect(state.handNumber).toBe(1)
    expect(state.communityCards.length).toBe(0)
    expect(state.players.every((player) => player.holeCards.length === 2)).toBe(true)
  })

  it('currentActor is UTG preflop', () => {
    const engine = new PokerEngine()
    const state = engine.createInitialState(defaultConfig, ['a', 'b', 'c', 'd', 'e', 'f'])
    const actorId = engine.currentActor(state)
    expect(actorId).not.toBeNull()

    const actor = state.players.find((player) => player.id === actorId)
    expect(actor?.seatIndex).toBe((state.dealerIndex + 3) % 6)
  })

  it('throws if fewer than 2 players', () => {
    const engine = new PokerEngine()
    expect(() => engine.createInitialState(defaultConfig, ['a'])).toThrow(/at least 2/)
  })
})

describe('PokerEngine.availableActions', () => {
  it('preflop UTG can fold/call/raise', () => {
    const engine = new PokerEngine()
    const state = engine.createInitialState(defaultConfig, ['a', 'b', 'c', 'd', 'e', 'f'])
    const actor = engine.currentActor(state)
    expect(actor).not.toBeNull()

    const types = engine.availableActions(state, actor!).map((action) => action.type)
    expect(types).toContain('fold')
    expect(types).toContain('call')
    expect(types).toContain('raise')
  })

  it('check unavailable when there is a bet to call', () => {
    const engine = new PokerEngine()
    const state = engine.createInitialState(defaultConfig, ['a', 'b'])
    const actor = engine.currentActor(state)
    expect(actor).not.toBeNull()

    expect(engine.availableActions(state, actor!).map((action) => action.type)).not.toContain('check')
  })
})

describe('PokerEngine.applyAction', () => {
  it('fold marks player folded', () => {
    const engine = new PokerEngine()
    const state = engine.createInitialState(defaultConfig, ['a', 'b', 'c', 'd', 'e', 'f'])
    const actor = engine.currentActor(state)
    expect(actor).not.toBeNull()

    const { nextState, events } = engine.applyAction(state, actor!, { type: 'fold' })
    expect(nextState.players.find((player) => player.id === actor)?.status).toBe('folded')
    expect(events.some((event) => event.kind === 'poker/action' && event.payload.type === 'fold')).toBe(true)
  })

  it('call matches highest bet', () => {
    const engine = new PokerEngine()
    const state = engine.createInitialState(defaultConfig, ['a', 'b', 'c', 'd', 'e', 'f'])
    const actor = engine.currentActor(state)
    expect(actor).not.toBeNull()

    const maxBet = Math.max(...state.players.map((player) => player.currentBet))
    const { nextState } = engine.applyAction(state, actor!, { type: 'call', amount: maxBet })
    expect(nextState.players.find((player) => player.id === actor)?.currentBet).toBe(maxBet)
  })

  it('raise advances betsThisStreet', () => {
    const engine = new PokerEngine()
    const state = engine.createInitialState(defaultConfig, ['a', 'b', 'c', 'd', 'e', 'f'])
    const actor = engine.currentActor(state)
    expect(actor).not.toBeNull()

    const { nextState } = engine.applyAction(state, actor!, {
      type: 'raise',
      toAmount: state.bigBlind + state.smallBlind,
    })

    expect(nextState.betsThisStreet).toBe(state.betsThisStreet + 1)
  })

  it('no raise after 4-bet cap', () => {
    const engine = new PokerEngine()
    const state = {
      ...engine.createInitialState(defaultConfig, ['a', 'b', 'c', 'd', 'e', 'f']),
      betsThisStreet: 4,
    }
    const actor = engine.currentActor(state)
    expect(actor).not.toBeNull()

    expect(engine.availableActions(state, actor!).map((action) => action.type)).not.toContain('raise')
  })
})
