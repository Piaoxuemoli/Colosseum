/**
 * Response Parser - Parses and validates LLM responses
 */

import type { ActionType } from '../../../types/action'
import type { AvailableAction } from '../engine/poker-engine'
import type { RawImpressionScores } from './poker-ema'

export interface ParsedAction {
  type: ActionType
  amount: number
}

export interface ParseResult {
  thinking: string
  action: ParsedAction
}

/**
 * Parse thinking and action from LLM response.
 * Supports both new format (plain action name) and legacy format (JSON).
 *   New: <action>fold</action>
 *   Legacy: <action>{"type":"fold","amount":0}</action>
 */
export function parseThinkingAndAction(response: string): ParseResult | null {
  // Extract thinking
  const thinkingMatch = response.match(/<thinking>([\s\S]*?)<\/thinking>/)
  const thinking = thinkingMatch ? thinkingMatch[1].trim() : ''

  // Extract action
  const actionMatch = response.match(/<action>([\s\S]*?)<\/action>/)
  if (!actionMatch) {
    // Try to find JSON directly in the response as fallback
    const jsonMatch = response.match(/\{[\s\S]*?"type"\s*:\s*"[^"]+?"[\s\S]*?\}/)
    if (!jsonMatch) return null
    try {
      const parsed = JSON.parse(jsonMatch[0])
      return {
        thinking,
        action: { type: parsed.type, amount: parsed.amount || 0 },
      }
    } catch {
      return null
    }
  }

  const actionContent = actionMatch[1].trim()

  // Priority 1: plain action name (new format)
  const validActionNames = ['fold', 'check', 'call', 'bet', 'raise', 'allIn']
  if (validActionNames.includes(actionContent)) {
    return { thinking, action: { type: actionContent as ActionType, amount: 0 } }
  }

  // Priority 2: JSON format (legacy compatibility)
  try {
    const parsed = JSON.parse(actionContent)
    if (!parsed.type || typeof parsed.type !== 'string') return null

    return {
      thinking,
      action: {
        type: parsed.type as ActionType,
        amount: typeof parsed.amount === 'number' ? parsed.amount : 0,
      },
    }
  } catch {
    return null
  }
}

/**
 * Validate a parsed action against the list of valid actions.
 * Auto-clamps amounts and downgrades illegal actions.
 * Returns null if completely invalid (should fold).
 */
export function validateAction(
  parsed: ParsedAction,
  validActions: AvailableAction[],
): ParsedAction | null {
  const validTypes = new Set(validActions.map(a => a.type))

  // Direct match
  if (validTypes.has(parsed.type)) {
    const matchingAction = validActions.find(a => a.type === parsed.type)!
    return clampAction(parsed, matchingAction)
  }

  // Try to map common mistakes
  // "bet" when should "raise" or vice versa
  if (parsed.type === 'bet' && validTypes.has('raise')) {
    const raiseAction = validActions.find(a => a.type === 'raise')!
    return clampAction({ type: 'raise', amount: parsed.amount }, raiseAction)
  }
  if (parsed.type === 'raise' && validTypes.has('bet')) {
    const betAction = validActions.find(a => a.type === 'bet')!
    return clampAction({ type: 'bet', amount: parsed.amount }, betAction)
  }

  // "check" when should "call" (perhaps confused)
  if (parsed.type === 'check' && !validTypes.has('check') && validTypes.has('call')) {
    const callAction = validActions.find(a => a.type === 'call')!
    return clampAction({ type: 'call', amount: callAction.minAmount || 0 }, callAction)
  }

  // Can't fix — return null (caller should fold)
  return null
}

/**
 * Clamp action amount to valid range.
 */
function clampAction(parsed: ParsedAction, valid: AvailableAction): ParsedAction {
  // Actions without amounts
  if (parsed.type === 'fold' || parsed.type === 'check') {
    return { type: parsed.type, amount: 0 }
  }

  // Fixed amount actions
  if (parsed.type === 'call' || parsed.type === 'allIn') {
    return { type: parsed.type, amount: valid.minAmount || 0 }
  }

  // Variable amount actions (bet, raise)
  const min = valid.minAmount || 0
  const max = valid.maxAmount || min
  let amount = parsed.amount

  // Clamp to range
  if (amount < min) amount = min
  if (amount > max) amount = max

  // If clamped to max and that equals allIn amount, convert to allIn
  // (handled by engine anyway)

  return { type: parsed.type, amount: Math.round(amount) }
}

/**
 * Build an error message for retry when parsing/validation fails.
 */
export function buildRetryPrompt(error: string): string {
  return `你上次的回复格式不正确。${error}

请在 <action> 标签中输出操作名（如 fold/check/call/bet/raise）:
<thinking>分析</thinking>
<action>操作名</action>`
}

/**
 * Parse impression update response.
 * Expects format:
 *   <impressions>
 *   - PlayerName: impression text
 *   </impressions>
 */
export function parseImpressions(
  response: string,
  playerNames: string[],
): Record<string, string> | null {
  const match = response.match(/<impressions>([\s\S]*?)<\/impressions>/)
  if (!match) return null

  const content = match[1].trim()
  const result: Record<string, string> = {}

  for (const name of playerNames) {
    // Match "- Name: impression" pattern
    const lineRegex = new RegExp(`-\\s*${escapeRegex(name)}\\s*[:：]\\s*(.+)`, 'i')
    const lineMatch = content.match(lineRegex)
    if (lineMatch) {
      let impression = lineMatch[1].trim()
      // Truncate to 20 chars
      if (impression.length > 20) {
        impression = impression.slice(0, 20)
      }
      result[name] = impression
    }
  }

  return Object.keys(result).length > 0 ? result : null
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Parse structured impression scores from LLM response.
 * Expects format:
 *   <scores>
 *   - PlayerName: L=7 A=8 S=3 H=6 | 备注文字
 *   </scores>
 *
 * Returns name-keyed map of raw scores, or null if parsing fails.
 */
export function parseStructuredImpressions(
  response: string,
  playerNames: string[],
): Record<string, RawImpressionScores> | null {
  const match = response.match(/<scores>([\s\S]*?)<\/scores>/)
  if (!match) return null

  const content = match[1].trim()
  const result: Record<string, RawImpressionScores> = {}

  for (const name of playerNames) {
    // Match "- Name: L=7 A=8 S=3 H=6 | 备注" or "- Name: L=7 A=8 S=3 H=6"
    const lineRegex = new RegExp(
      `-\\s*${escapeRegex(name)}\\s*[:：]\\s*L\\s*=\\s*(\\d+\\.?\\d*)\\s+A\\s*=\\s*(\\d+\\.?\\d*)\\s+S\\s*=\\s*(\\d+\\.?\\d*)\\s+H\\s*=\\s*(\\d+\\.?\\d*)(?:\\s*\\|\\s*(.+))?`,
      'i',
    )
    const lineMatch = content.match(lineRegex)
    if (lineMatch) {
      const looseness = parseFloat(lineMatch[1])
      const aggression = parseFloat(lineMatch[2])
      const stickiness = parseFloat(lineMatch[3])
      const honesty = parseFloat(lineMatch[4])
      const note = (lineMatch[5] || '').trim().slice(0, 30)

      result[name] = { looseness, aggression, stickiness, honesty, note }
    }
  }

  return Object.keys(result).length > 0 ? result : null
}
