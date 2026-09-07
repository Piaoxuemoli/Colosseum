import { describe, expect, it, vi } from 'vitest'
import { coerceToValidAction } from '@/backend/orchestrator/action-validator'
import type { ActionSpec } from '@/platform/engine/contracts'
import type { BotStrategy } from '@/platform/core/registry'
import type { PokerAction } from '@/games/poker/engine/poker-types'
import type { WerewolfAction } from '@/games/werewolf/engine/types'

/** Synthetic state object so we can assert the bot fallback receives it verbatim. */
const state = { marker: 'game-state' }

const meta = { matchId: 'm_test', agentId: 'agt_self', layerIfPassed: 'parse' as const }
const validateMeta = { matchId: 'm_test', agentId: 'agt_self', layerIfPassed: 'validate' as const }

/** A bot strategy that is obviously synthetic so a fallback is visible in assertions. */
function makeBot(action: unknown): BotStrategy {
  return { decide: vi.fn(() => action) }
}

describe('coerceToValidAction — legal action pass-through', () => {
  it('returns a matched type-less action unchanged', () => {
    const valid: ActionSpec<PokerAction>[] = [{ type: 'fold' }]
    const result = coerceToValidAction({ type: 'fold' }, valid, state, makeBot(null), meta)
    expect(result.layer).toBe('parse')
    expect(result.action).toEqual({ type: 'fold' })
  })

  it('normalizes a matched call amount to the legal min/max window', () => {
    const valid: ActionSpec<PokerAction>[] = [{ type: 'call', minAmount: 6, maxAmount: 6 }]
    const result = coerceToValidAction({ type: 'call', amount: 999 }, valid, state, makeBot(null), meta)
    expect(result.layer).toBe('parse')
    expect(result.action).toEqual({ type: 'call', amount: 6 })
  })

  it('drops unrelated candidate fields when normalizing a minAmount action', () => {
    const valid: ActionSpec<PokerAction>[] = [{ type: 'call', minAmount: 6, maxAmount: 6 }]
    const result = coerceToValidAction(
      { type: 'call', amount: 6, reasoning: 'pot odds' } as unknown as PokerAction,
      valid,
      state,
      makeBot(null),
      meta,
    )
    expect(result.action).toEqual({ type: 'call', amount: 6 })
  })

  it('uses the spec template when the matched action defines one', () => {
    const template = { type: 'day/speak', content: 'I pass this turn.' } as WerewolfAction
    const valid: ActionSpec<WerewolfAction>[] = [{ type: 'day/speak', template }]
    const result = coerceToValidAction(
      { type: 'day/speak', content: 'ignored candidate content' } as WerewolfAction,
      valid,
      state,
      makeBot(null),
      meta,
    )
    expect(result.action).toEqual(template)
  })

  it('propagates layerIfPassed through the matched path', () => {
    const valid: ActionSpec<PokerAction>[] = [{ type: 'check' }]
    const result = coerceToValidAction({ type: 'check' }, valid, state, makeBot(null), validateMeta)
    expect(result.layer).toBe('validate')
    expect(result.action).toEqual({ type: 'check' })
  })
})

describe('coerceToValidAction — raise amount coercion and clamping', () => {
  const raiseSpec = (min: number, max?: number): ActionSpec<PokerAction> =>
    max === undefined ? { type: 'raise', minAmount: min } : { type: 'raise', minAmount: min, maxAmount: max }

  it('keeps a legal toAmount', () => {
    const result = coerceToValidAction(
      { type: 'raise', toAmount: 50 },
      [raiseSpec(4, 200)],
      state,
      makeBot(null),
      meta,
    )
    expect(result.action).toEqual({ type: 'raise', toAmount: 50 })
  })

  it('falls back to the amount field when toAmount is missing', () => {
    const result = coerceToValidAction(
      { type: 'raise', amount: 60 } as unknown as PokerAction,
      [raiseSpec(4, 200)],
      state,
      makeBot(null),
      meta,
    )
    expect(result.action).toEqual({ type: 'raise', toAmount: 60 })
  })

  it('clamps a raise below the minimum up to minAmount', () => {
    const result = coerceToValidAction(
      { type: 'raise', toAmount: 2 },
      [raiseSpec(4, 200)],
      state,
      makeBot(null),
      meta,
    )
    expect(result.action).toEqual({ type: 'raise', toAmount: 4 })
  })

  it('clamps a raise above the maximum down to maxAmount', () => {
    const result = coerceToValidAction(
      { type: 'raise', toAmount: 500 },
      [raiseSpec(4, 200)],
      state,
      makeBot(null),
      meta,
    )
    expect(result.action).toEqual({ type: 'raise', toAmount: 200 })
  })

  it('uses minAmount when the candidate carries no usable number', () => {
    const result = coerceToValidAction(
      { type: 'raise', toAmount: Number.NaN } as unknown as PokerAction,
      [raiseSpec(8, 8)],
      state,
      makeBot(null),
      meta,
    )
    expect(result.action).toEqual({ type: 'raise', toAmount: 8 })
  })

  it('snaps to the single legal raise value of a real street', () => {
    // The poker engine emits min === max === raiseTo for a legal raise.
    const result = coerceToValidAction(
      { type: 'raise', toAmount: 12345 },
      [raiseSpec(10, 10)],
      state,
      makeBot(null),
      meta,
    )
    expect(result.action).toEqual({ type: 'raise', toAmount: 10 })
  })
})

describe('coerceToValidAction — poker downgrades and synonyms', () => {
  it('downgrades a free fold to check when fold is not legal', () => {
    const valid: ActionSpec<PokerAction>[] = [{ type: 'check' }]
    const result = coerceToValidAction({ type: 'fold' }, valid, state, makeBot(null), meta)
    expect(result.layer).toBe('parse')
    expect(result.action).toEqual({ type: 'check' })
  })

  it('keeps a legal fold as fold', () => {
    const valid: ActionSpec<PokerAction>[] = [{ type: 'fold' }, { type: 'call', minAmount: 2, maxAmount: 2 }]
    const result = coerceToValidAction({ type: 'fold' }, valid, state, makeBot(null), meta)
    expect(result.action).toEqual({ type: 'fold' })
  })

  it('downgrades raise to call using the call amount, not the raise amount', () => {
    const valid: ActionSpec<PokerAction>[] = [{ type: 'call', minAmount: 6, maxAmount: 6 }]
    const result = coerceToValidAction(
      { type: 'raise', toAmount: 100 } as unknown as PokerAction,
      valid,
      state,
      makeBot(null),
      meta,
    )
    expect(result.layer).toBe('parse')
    expect(result.action).toEqual({ type: 'call', amount: 6 })
  })

  it('downgrades call to check when nothing is owed', () => {
    const valid: ActionSpec<PokerAction>[] = [{ type: 'check' }]
    const result = coerceToValidAction({ type: 'call', amount: 10 } as unknown as PokerAction, valid, state, makeBot(null), meta)
    expect(result.layer).toBe('parse')
    expect(result.action).toEqual({ type: 'check' })
  })

  it('rewrites bet to raise, carrying the bet amount as toAmount', () => {
    const valid: ActionSpec<PokerAction>[] = [{ type: 'raise', minAmount: 10, maxAmount: 100 }]
    const result = coerceToValidAction({ type: 'bet', amount: 40 }, valid, state, makeBot(null), meta)
    expect(result.layer).toBe('parse')
    expect(result.action).toEqual({ type: 'raise', toAmount: 40 })
  })

  it('clamps a bet-to-raise rewrite into the legal window', () => {
    const valid: ActionSpec<PokerAction>[] = [{ type: 'raise', minAmount: 10, maxAmount: 100 }]
    const result = coerceToValidAction({ type: 'bet', amount: 5 }, valid, state, makeBot(null), meta)
    expect(result.action).toEqual({ type: 'raise', toAmount: 10 })
  })

  it('normalizes all-in spelling variants to allIn', () => {
    const valid: ActionSpec<PokerAction>[] = [{ type: 'allIn', minAmount: 0 }]
    for (const alias of ['all-in', 'allin', 'all_in']) {
      const result = coerceToValidAction(
        { type: alias } as unknown as PokerAction,
        valid,
        state,
        makeBot(null),
        meta,
      )
      expect(result.action).toEqual({ type: 'allIn', amount: 0 })
    }
  })
})

describe('coerceToValidAction — werewolf type normalization', () => {
  it('maps a bare action type to its canonical phase/action type', () => {
    const valid: ActionSpec<WerewolfAction>[] = [{ type: 'day/vote' }]
    const result = coerceToValidAction(
      { type: 'vote', targetId: 'agt_b' } as unknown as WerewolfAction,
      valid,
      state,
      makeBot(null),
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
      state,
      makeBot(null),
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
        state,
        makeBot(null),
        meta,
      )
      expect(result.action).toEqual({ type: 'day/vote', targetId: null })
    }
  })

  it('unifies separators (seer_check / werewolf_kill) and case', () => {
    const valid: ActionSpec<WerewolfAction>[] = [{ type: 'night/seerCheck' }]
    const result = coerceToValidAction(
      { type: 'seer_check', targetId: 'agt_y' } as unknown as WerewolfAction,
      valid,
      state,
      makeBot(null),
      meta,
    )
    expect(result.layer).toBe('parse')
    expect(result.action).toEqual({ type: 'night/seerCheck', targetId: 'agt_y' })
  })

  it('maps natural-language synonyms (check/verify -> seerCheck)', () => {
    const valid: ActionSpec<WerewolfAction>[] = [{ type: 'night/seerCheck' }]
    for (const alias of ['check', 'verify']) {
      const result = coerceToValidAction(
        { type: alias, targetId: 'agt_y' } as unknown as WerewolfAction,
        valid,
        state,
        makeBot(null),
        meta,
      )
      expect(result.action).toEqual({ type: 'night/seerCheck', targetId: 'agt_y' })
    }
  })

  it('passes canonical types through unchanged (idempotent)', () => {
    const valid: ActionSpec<WerewolfAction>[] = [{ type: 'night/witchPoison' }]
    const result = coerceToValidAction(
      { type: 'night/witchPoison', targetId: null },
      valid,
      state,
      makeBot(null),
      meta,
    )
    expect(result.layer).toBe('parse')
    expect(result.action).toEqual({ type: 'night/witchPoison', targetId: null })
  })

  it('falls back to bot strategy when the alias resolves to an action not legal this phase', () => {
    // Phase only allows day/vote, but the model emitted a "kill" alias.
    const valid: ActionSpec<WerewolfAction>[] = [{ type: 'day/vote' }]
    const bot = makeBot({ type: 'day/speak', content: 'BOT-FALLBACK' })
    const result = coerceToValidAction(
      { type: 'kill', targetId: 'agt_z' } as unknown as WerewolfAction,
      valid,
      state,
      bot,
      meta,
    )
    expect(result.layer).toBe('fallback')
    expect(result.action).toEqual({ type: 'day/speak', content: 'BOT-FALLBACK' })
  })
})

describe('coerceToValidAction — fallback path', () => {
  it('delegates to the bot strategy with state and valid actions on an illegal type', () => {
    const valid: ActionSpec<PokerAction>[] = [{ type: 'check' }]
    const bot = makeBot({ type: 'check' })
    const result = coerceToValidAction({ type: 'teleport' } as unknown as PokerAction, valid, state, bot, meta)
    expect(result.layer).toBe('fallback')
    expect(result.action).toEqual({ type: 'check' })
    expect(bot.decide).toHaveBeenCalledWith(state, valid)
    expect(bot.decide).toHaveBeenCalledTimes(1)
  })

  it('falls back for candidates without a usable string type', () => {
    const valid: ActionSpec<PokerAction>[] = [{ type: 'check' }]
    const bot = makeBot({ type: 'check' })
    for (const candidate of [null, 'fold', 42, {}, { type: 7 }, []]) {
      const result = coerceToValidAction(candidate as unknown as PokerAction, valid, state, bot, meta)
      expect(result.layer).toBe('fallback')
    }
    expect(bot.decide).toHaveBeenCalledTimes(6)
  })

  it('does not fall back when a poker synonym resolves the candidate', () => {
    const valid: ActionSpec<PokerAction>[] = [{ type: 'check' }]
    const bot = makeBot({ type: 'check' })
    const result = coerceToValidAction({ type: 'call' } as unknown as PokerAction, valid, state, bot, meta)
    // 'call' is a poker synonym of 'check' — normalized via the poker path, not the bot.
    expect(result.layer).toBe('parse')
    expect(result.action).toEqual({ type: 'check' })
    expect(bot.decide).not.toHaveBeenCalled()
  })
})
