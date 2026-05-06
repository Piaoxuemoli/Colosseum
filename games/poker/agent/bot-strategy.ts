import type { BotStrategy } from '@/lib/core/registry'
import type { ActionSpec } from '@/lib/engine/contracts'
import { rankValue, type Rank } from '../engine/card'
import type { PokerAction, PokerState } from '../engine/poker-types'

export class PokerBotStrategy implements BotStrategy {
  constructor(private readonly rng: () => number = Math.random) {}

  decide(gameStateRaw: unknown, validActionsRaw: unknown[]): PokerAction {
    const state = gameStateRaw as PokerState
    const validActions = validActionsRaw as ActionSpec<PokerAction>[]
    if (validActions.length === 0) return { type: 'fold' }

    const me = state.players.find((player) => player.id === state.currentActor)
    if (!me) return this.pickFoldOrCheck(validActions)

    const strength = this.handStrength(me.holeCards)
    const noise = this.rng()

    if (state.phase === 'preflop') {
      if (strength >= 0.75) return this.pickRaiseOrCall(validActions, noise)
      if (strength >= 0.45) return this.pickCallOrCheck(validActions)
      return this.pickFoldOrCheck(validActions)
    }

    if (strength >= 0.7 && noise < 0.6) return this.pickRaiseOrCall(validActions, noise)
    return this.pickCallOrCheck(validActions)
  }

  private handStrength(holeCards: Array<{ rank: string }>): number {
    if (holeCards.length < 2) return 0.3
    const [a, b] = holeCards
    const first = rankValue(a.rank as Rank)
    const second = rankValue(b.rank as Rank)
    const high = Math.max(first, second)
    const low = Math.min(first, second)

    if (first === second) return Math.min(1, 0.5 + (first - 2) / 24)

    const connector = high - low === 1 ? 0.08 : 0
    return Math.min(1, Math.max(0.15, (high - 5) / 20 + connector))
  }

  private pickRaiseOrCall(actions: ActionSpec<PokerAction>[], noise: number): PokerAction {
    const aggressive = actions.find((action) => action.type === 'raise' || action.type === 'bet')
    if (aggressive && noise < 0.6) {
      if (aggressive.type === 'raise') return { type: 'raise', toAmount: aggressive.minAmount ?? 0 }
      return { type: 'bet', amount: aggressive.minAmount ?? 0 }
    }

    return this.pickCallOrCheck(actions)
  }

  private pickCallOrCheck(actions: ActionSpec<PokerAction>[]): PokerAction {
    const check = actions.find((action) => action.type === 'check')
    if (check) return { type: 'check' }

    const call = actions.find((action) => action.type === 'call')
    if (call) return { type: 'call', amount: call.minAmount ?? 0 }

    const allIn = actions.find((action) => action.type === 'allIn')
    if (allIn) return { type: 'allIn', amount: allIn.minAmount ?? 0 }

    return { type: 'fold' }
  }

  private pickFoldOrCheck(actions: ActionSpec<PokerAction>[]): PokerAction {
    const check = actions.find((action) => action.type === 'check')
    if (check) return { type: 'check' }
    return { type: 'fold' }
  }
}
