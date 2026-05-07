import { beforeEach, describe, expect, it } from 'vitest'
import { clearRegistry, hasGame } from '@/lib/core/registry'
import { ensureGamesRegistered } from '@/lib/instrument'

describe('ensureGamesRegistered', () => {
  beforeEach(() => clearRegistry())

  it('registers on first call', () => {
    expect(hasGame('poker')).toBe(false)
    ensureGamesRegistered()
    expect(hasGame('poker')).toBe(true)
  })

  it('is idempotent', () => {
    ensureGamesRegistered()
    ensureGamesRegistered()
    expect(hasGame('poker')).toBe(true)
  })
})
