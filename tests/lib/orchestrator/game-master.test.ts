import { describe, expect, it } from 'vitest'
import { PokerBotStrategy } from '@/games/poker/agent/bot-strategy'
import type { ActionSpec } from '@/lib/engine/contracts'
import { coerceToValidAction } from '@/lib/orchestrator/action-validator'

describe('coerceToValidAction', () => {
  it('passes through valid action', () => {
    const valid = [{ type: 'fold' }, { type: 'call', minAmount: 4, maxAmount: 4 }] as ActionSpec<unknown>[]
    const result = coerceToValidAction({ type: 'fold' }, valid, {}, new PokerBotStrategy(), {
      matchId: 'match_1',
      agentId: 'agt_1',
      layerIfPassed: 'parse',
    })

    expect((result.action as { type: string }).type).toBe('fold')
    expect(result.layer).toBe('parse')
  })

  it('falls back when action type invalid', () => {
    const valid = [{ type: 'fold' }, { type: 'check' }] as ActionSpec<unknown>[]
    const result = coerceToValidAction(
      { type: 'bogus' },
      valid,
      { players: [], phase: 'preflop', currentActor: null },
      new PokerBotStrategy(),
      { matchId: 'match_1', agentId: 'agt_1', layerIfPassed: 'parse' },
    )

    expect(result.layer).toBe('fallback')
    expect(['fold', 'check']).toContain((result.action as { type: string }).type)
  })
})
