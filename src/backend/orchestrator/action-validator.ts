import type { BotStrategy } from '@/platform/core/registry'
import type { ActionSpec } from '@/platform/engine/contracts'
import { log } from '@/platform/telemetry/logger'
import { normalizeWerewolfActionType } from '@/games/werewolf/engine/werewolf-action-aliases'

export type ValidationResult<TAction> = {
  action: TAction
  layer: 'structured' | 'parse' | 'validate' | 'fallback'
}

export function coerceToValidAction<TAction>(
  candidate: TAction,
  validActions: ActionSpec<TAction>[],
  state: unknown,
  botStrategy: BotStrategy,
  meta: { matchId: string; agentId: string; layerIfPassed: 'parse' | 'validate' },
): ValidationResult<TAction> {
  const actionType = actionTypeOf(candidate)
  const matched = validActions.find((action) => action.type === actionType)
  if (matched) return { action: normalizeMatchedAction(candidate, matched), layer: meta.layerIfPassed }

  // Werewolf type normalization: LLMs drift on the `phase/action` strings
  // (drop prefix, swap separators, use synonyms like "kill"/"skip"). Map the
  // candidate's type to a canonical werewolf type while keeping its other
  // fields (targetId / content / reason). Poker types return null here and
  // fall through to the poker-specific coercion paths below.
  const werewolfType = actionType !== null ? normalizeWerewolfActionType(actionType) : null
  if (werewolfType && werewolfType !== actionType) {
    const wwMatched = validActions.find((action) => action.type === werewolfType)
    if (wwMatched) {
      const rewritten = { ...(candidate as object), type: werewolfType } as TAction
      return { action: normalizeMatchedAction(rewritten, wwMatched), layer: meta.layerIfPassed }
    }
  }

  const freeFoldCoercion = coerceFreeFoldToCheck(actionType, validActions)
  if (freeFoldCoercion) return { action: freeFoldCoercion, layer: meta.layerIfPassed }

  const synonymCoercion = coerceActionSynonyms(actionType, candidate, validActions)
  if (synonymCoercion) return { action: synonymCoercion, layer: meta.layerIfPassed }

  log.warn('action-validator: invalid action, falling back to BotStrategy', {
    matchId: meta.matchId,
    agentId: meta.agentId,
    candidate,
  })

  return {
    action: botStrategy.decide(state, validActions as unknown[]) as TAction,
    layer: 'fallback',
  }
}

function actionTypeOf(candidate: unknown): string | null {
  if (typeof candidate !== 'object' || candidate === null || !('type' in candidate)) return null
  const type = (candidate as { type?: unknown }).type
  return typeof type === 'string' ? type : null
}

function coerceFreeFoldToCheck<TAction>(
  actionType: string | null,
  validActions: ActionSpec<TAction>[],
): TAction | null {
  if (actionType !== 'fold') return null
  const check = validActions.find((action) => action.type === 'check')
  return check ? ({ type: 'check' } as TAction) : null
}

function coerceActionSynonyms<TAction>(
  actionType: string | null,
  candidate: TAction,
  validActions: ActionSpec<TAction>[],
): TAction | null {
  if (!actionType) return null
  const candidateRecord = candidate as unknown as Record<string, unknown>

  const synonyms: Record<string, string[]> = {
    bet: ['raise'],
    raise: ['bet', 'call'],
    check: ['call'],
    call: ['check'],
    allin: ['allIn', 'call'],
    'all-in': ['allIn', 'call'],
    all_in: ['allIn', 'call'],
  }

  for (const alias of [actionType, ...(synonyms[actionType] ?? [])]) {
    const spec = validActions.find((action) => action.type === alias)
    if (!spec) continue

    if (spec.minAmount === undefined) return { type: alias } as TAction

    if (alias === 'raise') {
      const raw =
        typeof candidateRecord.toAmount === 'number'
          ? candidateRecord.toAmount
          : typeof candidateRecord.amount === 'number'
            ? candidateRecord.amount
            : spec.minAmount
      return { type: 'raise', toAmount: clamp(raw, spec.minAmount, spec.maxAmount) } as TAction
    }

    // Cross-type synonyms should use the target action's legal amount rather
    // than the original amount (e.g. raise -> call uses the call amount).
    const isSameType = alias === actionType
    const raw = isSameType
      ? typeof candidateRecord.amount === 'number'
        ? candidateRecord.amount
        : typeof candidateRecord.toAmount === 'number'
          ? candidateRecord.toAmount
          : spec.minAmount
      : spec.minAmount
    return { type: alias, amount: clamp(raw, spec.minAmount, spec.maxAmount) } as TAction
  }

  return null
}

function normalizeMatchedAction<TAction>(candidate: TAction, matched: ActionSpec<TAction>): TAction {
  if (matched.template) return matched.template
  if (matched.minAmount === undefined) return candidate

  const candidateRecord = candidate as unknown as Record<string, unknown>
  const rawAmount =
    typeof candidateRecord.toAmount === 'number'
      ? candidateRecord.toAmount
      : typeof candidateRecord.amount === 'number'
        ? candidateRecord.amount
        : undefined

  if (matched.type === 'raise') {
    const toAmount = clamp(rawAmount, matched.minAmount, matched.maxAmount)
    return { type: 'raise', toAmount } as TAction
  }

  const amount = clamp(rawAmount, matched.minAmount, matched.maxAmount)
  return { type: matched.type, amount } as TAction
}

function clamp(value: number | undefined, min: number, max?: number): number {
  if (value === undefined || !Number.isFinite(value)) return min
  let result = Math.max(min, value)
  if (max !== undefined && Number.isFinite(max)) result = Math.min(max, result)
  return result
}
