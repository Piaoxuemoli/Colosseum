import { describe, expect, it } from 'vitest'
import { coerceToValidAction } from '../action-validator'
import type { ActionSpec } from '@/platform/engine/contracts'
import type { WerewolfAction } from '@/games/werewolf/engine/types'

/** A bot strategy that is obviously synthetic so a fallback is visible in assertions. */
const sentinelBot = {
  decide: () => ({ type: 'day/speak', content: 'BOT-FALLBACK' }) as unknown as WerewolfAction,
}

const meta = { matchId: 'm_test', agentId: 'agt_self', layerIfPassed: 'parse' as const }

describe('coerceToValidAction — werewolf type normalization', () => {
  it('maps a bare action type to its canonical phase/action type', () => {
    const valid: ActionSpec<WerewolfAction>[] = [{ type: 'day/vote' }]
    const result = coerceToValidAction(
      { type: 'vote', targetId: 'agt_b' } as WerewolfAction,
      valid,
      null,
      sentinelBot,
      meta,
    )
    expect(result.layer).toBe('parse')
    expect(result.action).toEqual({ type: 'day/vote', targetId: 'agt_b' })
  })

  it('keeps targetId when normalizing night/werewolfKill aliases', () => {
    const valid: ActionSpec<WerewolfAction>[] = [{ type: 'night/werewolfKill' }]
    const result = coerceToValidAction(
      { type: 'kill', targetId: 'agt_x', reasoning: 'bot' } as unknown as WerewolfAction,
      valid,
      null,
      sentinelBot,
      meta,
    )
    expect(result.layer).toBe('parse')
    expect(result.action).toEqual({ type: 'night/werewolfKill', targetId: 'agt_x', reasoning: 'bot' })
  })

  it('maps skip/pass/abstain to day/vote while preserving null target', () => {
    const valid: ActionSpec<WerewolfAction>[] = [{ type: 'day/vote' }]
    for (const alias of ['skip', 'pass', 'abstain']) {
      const result = coerceToValidAction(
        { type: alias, targetId: null } as unknown as WerewolfAction,
        valid,
        null,
        sentinelBot,
        meta,
      )
      expect(result.action).toEqual({ type: 'day/vote', targetId: null })
    }
  })

  it('unifies separators (werewolf_kill / werewolfKill) and case', () => {
    const valid: ActionSpec<WerewolfAction>[] = [{ type: 'night/seerCheck' }]
    const result = coerceToValidAction(
      { type: 'seer_check', targetId: 'agt_y' } as unknown as WerewolfAction,
      valid,
      null,
      sentinelBot,
      meta,
    )
    expect(result.layer).toBe('parse')
    expect(result.action).toEqual({ type: 'night/seerCheck', targetId: 'agt_y' })
  })

  it('passes canonical types through unchanged (idempotent)', () => {
    const valid: ActionSpec<WerewolfAction>[] = [{ type: 'night/witchPoison' }]
    const result = coerceToValidAction(
      { type: 'night/witchPoison', targetId: null } as WerewolfAction,
      valid,
      null,
      sentinelBot,
      meta,
    )
    expect(result.action).toEqual({ type: 'night/witchPoison', targetId: null })
  })

  it('falls back to bot strategy when the alias resolves to an action not legal this phase', () => {
    // Phase only allows day/vote, but the model emitted a "kill" alias.
    const valid: ActionSpec<WerewolfAction>[] = [{ type: 'day/vote' }]
    const result = coerceToValidAction(
      { type: 'kill', targetId: 'agt_z' } as unknown as WerewolfAction,
      valid,
      null,
      sentinelBot,
      meta,
    )
    expect(result.layer).toBe('fallback')
    expect(result.action).toEqual({ type: 'day/speak', content: 'BOT-FALLBACK' })
  })
})

describe('coerceToValidAction — poker path unaffected', () => {
  it('does not treat a poker action type as a werewolf alias', () => {
    const valid: ActionSpec<unknown>[] = [{ type: 'check' }]
    const result = coerceToValidAction({ type: 'call' }, valid, null, sentinelBot, meta)
    // 'call' is a poker synonym of 'check' — should normalize via the poker path.
    expect(result.layer).toBe('parse')
    expect(result.action).toEqual({ type: 'check' })
  })
})
