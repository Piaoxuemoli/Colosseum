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
  const actionType = (candidate as { type?: string }).type
  const matched = validActions.find((action) => action.type === actionType)
  if (matched) return { action: candidate, layer: meta.layerIfPassed }

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
