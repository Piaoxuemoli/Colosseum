import type { ParsedResponse, ResponseParser } from '@/platform/core/registry'
import type { ActionSpec } from '@/platform/engine/contracts'
import type { PokerAction } from '../engine/poker-types'

type ParsedActionType = Exclude<PokerAction['type'], 'postSmallBlind' | 'postBigBlind'>

export class PokerResponseParser implements ResponseParser {
  parse(rawText: string, validActionsRaw: unknown[]): ParsedResponse {
    const validActions = validActionsRaw as ActionSpec<PokerAction>[]
    const thinking = this.extractTag(rawText, 'thinking') ?? ''
    const actionText = this.extractTag(rawText, 'action')?.trim()

    if (!actionText) {
      return { action: this.fallback(validActions), thinking, fallbackUsed: true }
    }

    const parsedAction = this.parseActionText(actionText, validActions)
    if (!parsedAction) {
      return { action: this.fallback(validActions), thinking, fallbackUsed: true }
    }

    return { action: parsedAction, thinking, fallbackUsed: false }
  }

  private extractTag(text: string, tag: string): string | null {
    const match = text.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'))
    return match ? match[1].trim() : null
  }

  private parseActionText(actionText: string, validActions: ActionSpec<PokerAction>[]): PokerAction | null {
    // Try JSON object first.
    const jsonAction = this.parseJsonAction(actionText)
    if (jsonAction) {
      const normalized = this.normalizeActionType(jsonAction.type, validActions)
      if (!normalized) return null
      return this.buildAction(normalized, jsonAction.amount, validActions)
    }

    // Fall back to plain text normalization.
    const normalized = this.normalizeActionType(actionText, validActions)
    if (!normalized) return null
    return this.buildAction(normalized, undefined, validActions)
  }

  private parseJsonAction(actionText: string): { type: string; amount?: number } | null {
    if (!actionText.startsWith('{')) return null
    try {
      const parsed = JSON.parse(actionText) as unknown
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
      const obj = parsed as Record<string, unknown>
      const type = typeof obj.type === 'string' ? obj.type : ''
      const amount = typeof obj.amount === 'number' ? obj.amount : undefined
      const toAmount = typeof obj.toAmount === 'number' ? obj.toAmount : undefined
      return { type, amount: amount ?? toAmount }
    } catch {
      return null
    }
  }

  private normalizeActionType(text: string, validActions: ActionSpec<PokerAction>[]): ParsedActionType | null {
    const lower = text.toLowerCase().replace(/[\s_-]+/g, '')

    const directMap: Record<string, ParsedActionType> = {
      fold: 'fold',
      弃牌: 'fold',
      check: 'check',
      过牌: 'check',
      call: 'call',
      跟注: 'call',
      bet: 'bet',
      下注: 'bet',
      raise: 'raise',
      加注: 'raise',
      allin: 'allIn',
      全下: 'allIn',
      全押: 'allIn',
    }

    for (const [key, value] of Object.entries(directMap)) {
      if (lower.startsWith(key) || lower.includes(key)) {
        if (validActions.some((action) => action.type === value)) return value
        const synonym = this.synonymFor(value, validActions)
        if (synonym) return synonym
      }
    }

    // If the LLM used a synonym not in the map above, try generic swaps.
    return this.synonymFor(lower as ParsedActionType, validActions)
  }

  private synonymFor(type: ParsedActionType, validActions: ActionSpec<PokerAction>[]): ParsedActionType | null {
    const swaps: Record<ParsedActionType, ParsedActionType[]> = {
      fold: [],
      check: ['call'],
      call: ['check'],
      bet: ['raise'],
      raise: ['bet'],
      allIn: [],
    }
    for (const candidate of [type, ...(swaps[type] ?? [])]) {
      if (validActions.some((action) => action.type === candidate)) return candidate
    }
    return null
  }

  private buildAction(type: ParsedActionType, amount: number | undefined, validActions: ActionSpec<PokerAction>[]): PokerAction | null {
    const spec = validActions.find((action) => action.type === type)
    if (!spec) return null

    const safeAmount = this.resolveAmount(amount, spec)

    switch (type) {
      case 'fold':
        return { type: 'fold' }
      case 'check':
        return { type: 'check' }
      case 'call':
        return { type: 'call', amount: safeAmount }
      case 'bet':
        return { type: 'bet', amount: safeAmount }
      case 'raise':
        return { type: 'raise', toAmount: safeAmount }
      case 'allIn':
        return { type: 'allIn', amount: safeAmount }
    }
  }

  private resolveAmount(amount: number | undefined, spec: ActionSpec<PokerAction>): number {
    if (typeof amount === 'number' && Number.isFinite(amount)) {
      if (typeof spec.minAmount === 'number' && amount < spec.minAmount) return spec.minAmount
      if (typeof spec.maxAmount === 'number' && amount > spec.maxAmount) return spec.maxAmount
      return amount
    }
    return spec.minAmount ?? 0
  }

  private fallback(validActions: ActionSpec<PokerAction>[]): PokerAction {
    if (validActions.some((action) => action.type === 'check')) return { type: 'check' }
    return { type: 'fold' }
  }
}
