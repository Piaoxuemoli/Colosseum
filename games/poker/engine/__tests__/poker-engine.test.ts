import { describe, expect, it } from 'vitest'
import { PokerEngine } from '../poker-engine'
import type { PokerAction, PokerConfig, PokerPlayerStatus } from '../poker-types'

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
    expect(state.pot).toBe(defaultConfig.smallBlind + defaultConfig.bigBlind)
    expect(state.streetPots.preflop).toBe(defaultConfig.smallBlind + defaultConfig.bigBlind)
    expect(state.smallBlindIndex).toBe((state.dealerIndex + 1) % 6)
    expect(state.bigBlindIndex).toBe((state.dealerIndex + 2) % 6)
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

describe('PokerEngine public state', () => {
  it('exposes full spectator state including hole cards, blinds, actor, and pots', () => {
    const engine = new PokerEngine()
    const state = engine.createInitialState(defaultConfig, ['a', 'b', 'c', 'd', 'e', 'f'])

    const snapshot = engine.createPublicState(state)

    expect(snapshot.handNumber).toBe(1)
    expect(snapshot.phase).toBe('preflop')
    expect(snapshot.currentActor).toBe(state.currentActor)
    expect(snapshot.dealerIndex).toBe(state.dealerIndex)
    expect(snapshot.smallBlindIndex).toBe(state.smallBlindIndex)
    expect(snapshot.bigBlindIndex).toBe(state.bigBlindIndex)
    expect(snapshot.pot).toBe(defaultConfig.smallBlind + defaultConfig.bigBlind)
    expect(snapshot.streetPots.preflop).toBe(defaultConfig.smallBlind + defaultConfig.bigBlind)
    expect(snapshot.players.every((player) => player.holeCards.length === 2)).toBe(true)
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

describe('PokerEngine street transitions', () => {
  it('flop is dealt after preflop completes', () => {
    const engine = new PokerEngine()
    let state = engine.createInitialState(defaultConfig, ['a', 'b', 'c', 'd', 'e', 'f'])
    let guard = 30

    while (state.phase === 'preflop' && guard-- > 0) {
      const actor = engine.currentActor(state)
      if (!actor) break
      const player = state.players.find((candidate) => candidate.id === actor)
      expect(player).toBeDefined()
      const maxBet = Math.max(...state.players.map((candidate) => candidate.currentBet))
      const toCall = maxBet - player!.currentBet
      const action: PokerAction = toCall > 0 ? { type: 'call', amount: toCall } : { type: 'check' }
      state = engine.applyAction(state, actor, action).nextState
    }

    expect(state.phase).toBe('flop')
    expect(state.communityCards.length).toBe(3)
    expect(state.betsThisStreet).toBe(0)
  })

  it('hand-end boundary when only 1 non-folded remains', () => {
    const engine = new PokerEngine()
    let state = engine.createInitialState(defaultConfig, ['a', 'b', 'c', 'd', 'e', 'f'])

    for (let i = 0; i < 5; i++) {
      const actor = engine.currentActor(state)
      if (!actor) break
      const previous = state
      state = engine.applyAction(state, actor, { type: 'fold' }).nextState

      if (i === 4) {
        expect(engine.boundary(previous, state)).toBe('hand-end')
      }
    }
  })
})

describe('PokerEngine.finalize', () => {
  it('returns ranking sorted by chips desc', () => {
    const engine = new PokerEngine()
    const state = {
      ...engine.createInitialState(defaultConfig, ['a', 'b', 'c', 'd', 'e', 'f']),
      matchComplete: true,
    }
    state.players = state.players.map((player, index) => ({
      ...player,
      chips: index === 0 ? 500 : index === 1 ? 300 : 0,
      status: (index > 1 ? 'eliminated' : 'active') as PokerPlayerStatus,
    }))

    const result = engine.finalize(state)

    expect(result.ranking.length).toBe(6)
    expect(result.ranking[0].rank).toBe(1)
    expect(result.ranking[0].score).toBeGreaterThanOrEqual(result.ranking[5].score)
  })
})

describe('PokerEngine settlement', () => {
  it('pot awarded when 5 fold to heads-up winner', () => {
    const engine = new PokerEngine()
    let state = engine.createInitialState(defaultConfig, ['a', 'b', 'c', 'd', 'e', 'f'])

    for (let i = 0; i < 5; i++) {
      const actor = engine.currentActor(state)
      if (!actor) break
      state = engine.applyAction(state, actor, { type: 'fold' }).nextState
    }

    const survivor = state.players.find((player) => player.status !== 'folded')
    const totalInitial = defaultConfig.startingChips * 6
    const totalNow = state.players.reduce((sum, player) => sum + player.chips, 0)

    expect(survivor).toBeDefined()
    expect(totalNow).toBe(totalInitial)
    expect(survivor!.chips).toBeGreaterThan(defaultConfig.startingChips)
  })
})

describe('PokerEngine hand continuation', () => {
  function foldToHandEnd(engine: PokerEngine) {
    let state = engine.createInitialState(defaultConfig, ['a', 'b', 'c', 'd', 'e', 'f'])

    for (let i = 0; i < 5; i++) {
      const actor = engine.currentActor(state)
      if (!actor) break
      state = engine.applyAction(state, actor, { type: 'fold' }).nextState
    }

    expect(state.handComplete).toBe(true)
    return state
  }

  it('starts the next hand after a hand ends when multiple players still have chips', () => {
    const engine = new PokerEngine()
    const ended = foldToHandEnd(engine)

    const { nextState, events } = engine.continueAfterHand(ended)

    expect(nextState.matchComplete).toBe(false)
    expect(nextState.handComplete).toBe(false)
    expect(nextState.handNumber).toBe(ended.handNumber + 1)
    expect(nextState.phase).toBe('preflop')
    expect(nextState.communityCards).toHaveLength(0)
    expect(nextState.players.every((player) => player.holeCards.length === 2 || player.status === 'eliminated')).toBe(true)
    expect(events.some((event) => event.kind === 'poker/hand-start')).toBe(true)
  })

  it('ends the match after the current hand when stop is requested', () => {
    const engine = new PokerEngine()
    const ended = { ...foldToHandEnd(engine), stopRequested: true }

    const { nextState, events } = engine.continueAfterHand(ended)

    expect(nextState.matchComplete).toBe(true)
    expect(events.some((event) => event.kind === 'poker/match-end')).toBe(true)
  })
})
