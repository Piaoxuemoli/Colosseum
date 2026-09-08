/**
 * 狼人杀 agent v2 响应解析器（spec §4）。
 *
 * 只负责从 LLM 文本中提取 <action> JSON——输出「原始动作对象」，
 * 不做合法性裁决：GM 侧 plugin.normalizeAction（引擎 zod normalize +
 * LLM 别名容错）才是最终裁决（final arbiter）。
 */

export type V2ParsedResponse = {
  action: Record<string, unknown> | null
  thinking: string
  fallbackUsed: boolean
}

export class WerewolfResponseParserV2 {
  parse(rawText: string): V2ParsedResponse {
    const thinking = extractTag(rawText, 'thinking') ?? extractTag(rawText, 'think') ?? ''
    const actionText = extractTag(rawText, 'action')?.trim()

    if (!actionText) {
      return { action: null, thinking, fallbackUsed: true }
    }
    const action = parseJsonObject(actionText)
    if (!action || typeof action.type !== 'string') {
      return { action: null, thinking, fallbackUsed: true }
    }
    return { action, thinking, fallbackUsed: false }
  }
}

function extractTag(text: string, tag: string): string | null {
  const match = text.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'))
  return match ? match[1].trim() : null
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  if (!text.startsWith('{')) {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    text = text.slice(start, end + 1)
  }
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}
