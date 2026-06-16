/**
 * Werewolf action-type normalization.
 *
 * LLMs routinely drift from the exact `phase/action` strings our engine
 * expects — dropping the `night/` or `day/` prefix, swapping `/` for `_`/`-`,
 * lower-casing, or using a natural-language synonym ("kill", "check",
 * "skip"). Without correction these land in `coerceToValidAction`'s fallback
 * path and get reported as `llm-invalid-action`.
 *
 * This module maps those common aliases back to the canonical action types
 * defined in `WerewolfAction`. It is a pure, idempotent string transform:
 * a canonical type passes through unchanged, a poker type returns `null`
 * (so the orchestrator's poker synonym path is unaffected), and an
 * unrecognised werewolf-ish type also returns `null` (so it still falls back
 * rather than silently producing an invalid action).
 */
import type { WerewolfAction } from './types'

/** Canonical werewolf action types, derived from the `WerewolfAction` union. */
export const WEREWOLF_ACTION_TYPES = [
  'night/werewolfKill',
  'night/seerCheck',
  'night/witchSave',
  'night/witchPoison',
  'day/speak',
  'day/vote',
] as const satisfies ReadonlyArray<WerewolfAction['type']>

export type WerewolfActionType = (typeof WEREWOLF_ACTION_TYPES)[number]

const CANONICAL_SET: ReadonlySet<string> = new Set(WEREWOLF_ACTION_TYPES)

/**
 * Maps an LLM-supplied action type to a canonical werewolf action type, or
 * `null` if the input is not a werewolf action.
 *
 * Resolution order:
 *   1. exact canonical match (fast path, also makes this idempotent)
 *   2. normalized shape: strip prefix, lower-case, unify separators
 *   3. semantic alias table ("kill" → werewolfKill, "skip"/"pass" → vote, …)
 *
 * Note: `skip`/`pass`/`abstain` resolve to `day/vote` because that is the
 * only canonical action that permits a null target (i.e. genuine abstain).
 * Mapping them to `night/witchPoison` would be wrong in a non-witch phase.
 */
export function normalizeWerewolfActionType(type: string): WerewolfActionType | null {
  // 1. exact / already canonical
  if (CANONICAL_SET.has(type)) return type as WerewolfActionType

  // 2. normalize separators + case, drop the phase prefix if present
  const stripped = type.replace(/^(night|day)[/_-]/i, '')
  const key = stripped.replace(/[/_-]/g, '').toLowerCase()

  const byShape: Record<string, WerewolfActionType> = {
    werewolfkill: 'night/werewolfKill',
    seercheck: 'night/seerCheck',
    witchsave: 'night/witchSave',
    witchpoison: 'night/witchPoison',
    speak: 'day/speak',
    vote: 'day/vote',
  }
  if (byShape[key]) return byShape[key]

  // 3. semantic synonyms. Keep skip/pass/abstain → vote (only vote allows null target).
  const byAlias: Record<string, WerewolfActionType> = {
    kill: 'night/werewolfKill',
    murder: 'night/werewolfKill',
    check: 'night/seerCheck',
    verify: 'night/seerCheck',
    save: 'night/witchSave',
    heal: 'night/witchSave',
    rescue: 'night/witchSave',
    poison: 'night/witchPoison',
    skip: 'day/vote',
    pass: 'day/vote',
    abstain: 'day/vote',
    say: 'day/speak',
    talk: 'day/speak',
    claim: 'day/speak',
  }
  return byAlias[key] ?? null
}
