import type { BotStrategy } from '@/lib/core/registry'
import type { ActionSpec } from '@/lib/engine/contracts'
import { log } from '@/lib/telemetry/logger'

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

  const freeFoldCoercion = coerceFreeFoldToCheck(actionType, validActions)
  if (freeFoldCoercion) return { action: freeFoldCoercion, layer: meta.layerIfPassed }

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

function normalizeMatchedAction<TAction>(candidate: TAction, matched: ActionSpec<TAction>): TAction {
  if (matched.template) return matched.template
  if (matched.minAmount === undefined) return candidate

  if (matched.type === 'raise') {
    return { type: 'raise', toAmount: matched.minAmount } as TAction
  }

  return { type: matched.type, amount: matched.minAmount } as TAction
}
