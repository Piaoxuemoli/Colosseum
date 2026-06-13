/**
 * Test helpers for game engine tests.
 */
import { GameEngine } from '../../games/poker/engine/poker-engine'
import type { GameConfig } from '../../games/poker/engine/poker-engine'

/**
 * Create a test GameEngine with the given number of players, chips, and bet sizes.
 * All players are 'bot' type for deterministic testing.
 * In Fixed-Limit: smallBlind = 小注, bigBlind = 大注.
 * SB blind = smallBlind/2, BB blind = smallBlind.
 */
export function createTestEngine(
  playerCount: number = 3,
  chips: number = 1000,
  blinds: { small: number; big: number } = { small: 2, big: 4 },
): GameEngine {
  const seats: GameConfig['seats'] = []
  for (let i = 0; i < playerCount; i++) {
    seats.push({
      type: 'bot',
      name: `Player${i}`,
      chips,
    })
  }

  return new GameEngine({
    seats,
    smallBlind: blinds.small,
    bigBlind: blinds.big,
    sessionId: 'test-session',
    timingConfig: { minActionInterval: 0, thinkingTimeout: 1000 },
  })
}

/**
 * Assert that total chips across all players + pot equals the expected total.
 */
export function assertChipConservation(engine: GameEngine): void {
  const state = engine.getState()
  const playerChips = state.players.reduce((sum, p) => sum + p.chips, 0)
  const total = playerChips + state.pot
  const expected = engine.getTotalChipsInGame()
  if (total !== expected) {
    throw new Error(
      `Chip conservation violated: expected ${expected}, got ${total} ` +
      `(players=${playerChips}, pot=${state.pot})`
    )
  }
}
