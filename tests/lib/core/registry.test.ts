import { beforeEach, describe, expect, it } from 'vitest'
import { clearRegistry, getGame, hasGame, registerGame } from '@/lib/core/registry'

describe('lib/core/registry', () => {
  beforeEach(() => clearRegistry())

  it('registers and retrieves a module', () => {
    const module = {
      gameType: 'poker' as const,
      engine: {} as never,
      memory: {} as never,
      playerContextBuilder: {} as never,
      responseParser: {} as never,
      botStrategy: {} as never,
    }

    registerGame(module)

    expect(hasGame('poker')).toBe(true)
    expect(getGame('poker')).toBe(module)
  })

  it('throws on unknown gameType', () => {
    expect(() => getGame('werewolf')).toThrow(/not registered/)
  })
})
