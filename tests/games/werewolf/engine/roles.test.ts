import { describe, expect, it } from 'vitest'
import { assignRoles, factionOf, seededRng, WEREWOLF_ROLE_COMPOSITION } from '@/games/werewolf/engine/roles'

describe('assignRoles', () => {
  it('assigns 6 agents with the exact simplified composition', () => {
    const r = assignRoles(['a', 'b', 'c', 'd', 'e', 'f'])
    const counts: Record<string, number> = {}
    for (const role of Object.values(r)) {
      counts[role] = (counts[role] ?? 0) + 1
    }
    expect(counts).toEqual(WEREWOLF_ROLE_COMPOSITION)
  })

  it('throws when not exactly 6 agents', () => {
    expect(() => assignRoles(['a', 'b'])).toThrow(/6 agents/)
    expect(() => assignRoles(['a', 'b', 'c', 'd', 'e', 'f', 'g'])).toThrow(/6 agents/)
  })

  it('is deterministic under the same seed', () => {
    const rng1 = seededRng(42)
    const rng2 = seededRng(42)
    const r1 = assignRoles(['a', 'b', 'c', 'd', 'e', 'f'], rng1)
    const r2 = assignRoles(['a', 'b', 'c', 'd', 'e', 'f'], rng2)
    expect(r1).toEqual(r2)
  })

  it('different seeds produce different assignments (statistical)', () => {
    const r1 = assignRoles(['a', 'b', 'c', 'd', 'e', 'f'], seededRng(1))
    const r2 = assignRoles(['a', 'b', 'c', 'd', 'e', 'f'], seededRng(2))
    // not guaranteed by the contract, but overwhelmingly likely with 6! = 720 permutations
    expect(r1).not.toEqual(r2)
  })
})

describe('factionOf', () => {
  it('werewolf -> werewolves', () => {
    expect(factionOf('werewolf')).toBe('werewolves')
  })
  it('seer / witch / villager -> villagers', () => {
    expect(factionOf('seer')).toBe('villagers')
    expect(factionOf('witch')).toBe('villagers')
    expect(factionOf('villager')).toBe('villagers')
  })
})
