import type { ParsedResponse, ResponseParser } from '@/lib/core/registry'
import type { WerewolfAction } from '../engine/types'
import type { BeliefEntry } from '../memory/types'

/**
 * Parses a werewolf LLM response.
 *
 * Expected output format:
 *   <thinking>...chain-of-thought...</thinking>
 *   <belief>{"a2": { "werewolf": 0.7, "villager": 0.2, "seer": 0.05, "witch": 0.05, ... }}</belief>
 *   <action>{"type":"day/vote","targetId":"a2"}</action>
 *
 * The `<belief>` block is **optional** and surfaces in `beliefUpdate` for the
 * memory layer to merge. The `<action>` block is **required** — on any parse
 * failure we fall back to a synthetic `day/speak` no-op so the response still
 * conforms to the ResponseParser contract.
 */
export class WerewolfResponseParser implements ResponseParser {
  parse(rawText: string, _validActionsRaw: unknown[]): ParsedResponse {
    const thinking = this.extractTag(rawText, 'thinking') ?? ''
    const actionRaw = this.extractTag(rawText, 'action')
    const beliefRaw = this.extractTag(rawText, 'belief')

    const beliefUpdate = this.parseBelief(beliefRaw)

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
      // Extra data is allowed on ParsedResponse via arbitrary index keys; callers
      // that know about belief can read `(parsed as any).beliefUpdate`.
      ...(Object.keys(beliefUpdate).length > 0 ? { beliefUpdate } : {}),
    } as ParsedResponse & { beliefUpdate?: Record<string, Partial<BeliefEntry>> }
  }

  private extractTag(raw: string, tag: string): string | null {
    const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i')
    const m = raw.match(re)
    return m ? m[1].trim() : null
  }

  private parseBelief(raw: string | null): Record<string, Partial<BeliefEntry>> {
    if (!raw) return {}
    try {
      const obj = JSON.parse(raw) as Record<string, Partial<BeliefEntry>>
      if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return {}
      return obj
    } catch {
      return {}
    }
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
