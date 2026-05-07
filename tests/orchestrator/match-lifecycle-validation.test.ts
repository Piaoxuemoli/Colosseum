import { describe, expect, it } from 'vitest'
import {
  MatchCreateValidationError,
  validateWerewolfCreate,
} from '@/lib/orchestrator/match-lifecycle-validation'

describe('validateWerewolfCreate', () => {
  const base = {
    agentIds: ['a', 'b', 'c', 'd', 'e', 'f'],
    moderatorAgentId: 'mod',
  }

  it('accepts exactly 6 player agents + a moderator', () => {
    expect(() => validateWerewolfCreate(base)).not.toThrow()
  })

  it('rejects when agent count ≠ 6', () => {
    expect(() =>
      validateWerewolfCreate({ ...base, agentIds: ['a', 'b', 'c', 'd', 'e'] }),
    ).toThrow(/6 player agents/)
    expect(() =>
      validateWerewolfCreate({ ...base, agentIds: [...base.agentIds, 'g'] }),
    ).toThrow(/6 player agents/)
  })

  it('rejects missing moderator', () => {
    expect(() =>
      validateWerewolfCreate({ ...base, moderatorAgentId: null }),
    ).toThrow(/moderator/i)
  })

  it('rejects duplicate agent ids', () => {
    expect(() =>
      validateWerewolfCreate({ ...base, agentIds: ['a', 'a', 'b', 'c', 'd', 'e'] }),
    ).toThrow(/duplicate/i)
  })

  it('rejects moderator included as a player', () => {
    expect(() =>
      validateWerewolfCreate({ ...base, moderatorAgentId: 'a' }),
    ).toThrow(/moderator.*player/i)
  })

  it('throws a typed MatchCreateValidationError so callers can distinguish it from infra errors', () => {
    try {
      validateWerewolfCreate({ ...base, moderatorAgentId: null })
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(MatchCreateValidationError)
      expect((err as Error).name).toBe('MatchCreateValidationError')
    }
  })
})
