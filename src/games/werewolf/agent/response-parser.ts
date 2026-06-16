import type { ParsedResponse, ResponseParser } from '@/platform/core/registry'
import type { WerewolfAction } from '../engine/types'

/**
 * Parses a werewolf LLM response.
 *
 * Expected output format:
 *   <thinking>...chain-of-thought...</thinking>
 *   <action>{"type":"day/vote","targetId":"a2"}</action>
 *
 * The `<action>` block is **required** — on any parse failure we fall back to
 * a synthetic `day/speak` no-op so the response still conforms to the
 * ResponseParser contract.
 */
export class WerewolfResponseParser implements ResponseParser {
  parse(rawText: string, _validActionsRaw: unknown[]): ParsedResponse {
    const thinking = this.extractTag(rawText, 'thinking') ?? ''
    const actionRaw = this.extractTag(rawText, 'action')

    if (!actionRaw) {
      return {
        action: this.safeFallback(),
        thinking,
        fallbackUsed: true,
      }
    }

    const action = this.parseAction(actionRaw)
    if (!action) {
      return {
        action: this.safeFallback(),
        thinking,
        fallbackUsed: true,
      }
    }

    return {
      action,
      thinking,
      fallbackUsed: false,
    }
  }

  private extractTag(raw: string, tag: string): string | null {
    const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i')
    const m = raw.match(re)
    return m ? m[1].trim() : null
  }

  private parseAction(raw: string): WerewolfAction | null {
    let obj: unknown
    try {
      obj = JSON.parse(raw)
    } catch {
      return null
    }
    if (!isRecord(obj) || typeof obj.type !== 'string') return null

    switch (obj.type) {
      case 'night/werewolfKill':
        if (typeof obj.targetId !== 'string') return null
        return {
          type: 'night/werewolfKill',
          targetId: obj.targetId,
          reasoning: typeof obj.reasoning === 'string' ? obj.reasoning : '',
        }
      case 'night/seerCheck':
        if (typeof obj.targetId !== 'string') return null
        return { type: 'night/seerCheck', targetId: obj.targetId }
      case 'night/witchSave':
        return { type: 'night/witchSave' }
      case 'night/witchPoison':
        if (obj.targetId !== null && typeof obj.targetId !== 'string') return null
        return { type: 'night/witchPoison', targetId: obj.targetId as string | null }
      case 'day/speak':
        if (typeof obj.content !== 'string') return null
        return {
          type: 'day/speak',
          content: obj.content.slice(0, 200),
          claimedRole: this.normalizeRole(obj.claimedRole),
        }
      case 'day/vote':
        if (obj.targetId !== null && typeof obj.targetId !== 'string') return null
        return {
          type: 'day/vote',
          targetId: obj.targetId as string | null,
          reason: typeof obj.reason === 'string' ? obj.reason : undefined,
        }
      default:
        return null
    }
  }

  private normalizeRole(value: unknown) {
    if (typeof value !== 'string') return undefined
    if (value === 'werewolf' || value === 'seer' || value === 'witch' || value === 'villager') {
      return value
    }
    return undefined
  }

  private safeFallback(): WerewolfAction {
    return { type: 'day/speak', content: '（解析失败，跳过本次发言）' }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
