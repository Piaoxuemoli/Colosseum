import { describe, expect, it } from 'vitest'
import { defaultMatchConfig, gameEventSchema, matchConfigSchema } from '@/lib/core/types'

describe('lib/core/types', () => {
  it('gameEventSchema accepts a valid public poker event', () => {
    const ok = gameEventSchema.safeParse({
      id: 'evt_1',
      matchId: 'match_1',
      gameType: 'poker',
      seq: 1,
      occurredAt: '2026-05-06T00:00:00Z',
      kind: 'poker/deal-hole',
      actorAgentId: null,
      payload: { to: 'agt_a' },
      visibility: 'public',
      restrictedTo: null,
    })

    expect(ok.success).toBe(true)
  })

  it('gameEventSchema rejects bad visibility', () => {
    const bad = gameEventSchema.safeParse({
      id: 'evt_1',
      matchId: 'match_1',
      gameType: 'poker',
      seq: 1,
      occurredAt: '2026-05-06T00:00:00Z',
      kind: 'x',
      actorAgentId: null,
      payload: {},
      visibility: 'bogus',
      restrictedTo: null,
    })

    expect(bad.success).toBe(false)
  })

  it('defaultMatchConfig returns sane defaults', () => {
    const config = defaultMatchConfig()

    expect(config.agentTimeoutMs).toBeGreaterThanOrEqual(30_000)
    expect(config.minActionIntervalMs).toBeGreaterThanOrEqual(0)
    expect(config.tickConcurrencyLockMs).toBeGreaterThan(0)
    expect(config.maxConsecutiveErrors).toBe(3)
  })

  it('matchConfigSchema validates known shape', () => {
    expect(matchConfigSchema.safeParse(defaultMatchConfig()).success).toBe(true)
  })
})
