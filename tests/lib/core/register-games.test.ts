import { beforeEach, describe, expect, it } from 'vitest'
import { clearRegistry, getGame, hasGame } from '@/lib/core/registry'
import { registerAllGames } from '@/lib/core/register-games'

describe('registerAllGames', () => {
  beforeEach(() => clearRegistry())

  it('registers poker plugin', () => {
    registerAllGames()

    expect(hasGame('poker')).toBe(true)
    const module = getGame('poker')
    expect(module.gameType).toBe('poker')
    expect(module.engine).toBeDefined()
    expect(module.memory).toBeDefined()
    expect(module.botStrategy).toBeDefined()
  })
})
