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
