import type { ParsedResponse, ResponseParser } from '@/lib/core/registry'
import type { ActionSpec } from '@/lib/engine/contracts'
import type { PokerAction } from '../engine/poker-types'

type ParsedActionType = Exclude<PokerAction['type'], 'postSmallBlind' | 'postBigBlind'>

export class PokerResponseParser implements ResponseParser {
  parse(rawText: string, validActionsRaw: unknown[]): ParsedResponse {
    const validActions = validActionsRaw as ActionSpec<PokerAction>[]
    const thinking = this.extractTag(rawText, 'thinking') ?? ''
    const actionText = this.extractTag(rawText, 'action')?.toLowerCase().trim()

    if (!actionText) {
      return { action: this.fallback(validActions), thinking, fallbackUsed: true }
    }

    const type = this.normalizeActionType(actionText, validActions)
    if (!type) {
      return { action: this.fallback(validActions), thinking, fallbackUsed: true }
    }

    const spec = validActions.find((action) => action.type === type)
    if (!spec) {
      return { action: this.fallback(validActions), thinking, fallbackUsed: true }
    }

    return {
      action: this.buildAction(type, spec.minAmount ?? 0),
      thinking,
      fallbackUsed: false,
    }
  }

  private extractTag(text: string, tag: string): string | null {
    const match = text.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'))
    return match ? match[1] : null
  }

  private normalizeActionType(text: string, validActions: ActionSpec<PokerAction>[]): ParsedActionType | null {
    if (text.startsWith('fold')) return 'fold'
    if (text.startsWith('check')) return 'check'
    if (text.startsWith('call')) return 'call'
    if (text.startsWith('bet') || text.startsWith('raise')) {
      if (validActions.some((action) => action.type === 'raise')) return 'raise'
      if (validActions.some((action) => action.type === 'bet')) return 'bet'
      return null
    }
    if (text.startsWith('all') || text.includes('all-in') || text.includes('all in')) return 'allIn'
    return null
  }

  private buildAction(type: ParsedActionType, amount: number): PokerAction {
    switch (type) {
      case 'fold':
        return { type: 'fold' }
      case 'check':
        return { type: 'check' }
      case 'call':
        return { type: 'call', amount }
      case 'bet':
        return { type: 'bet', amount }
      case 'raise':
        return { type: 'raise', toAmount: amount }
      case 'allIn':
        return { type: 'allIn', amount }
    }
  }

  private fallback(validActions: ActionSpec<PokerAction>[]): PokerAction {
    if (validActions.some((action) => action.type === 'check')) return { type: 'check' }
    return { type: 'fold' }
  }
}
