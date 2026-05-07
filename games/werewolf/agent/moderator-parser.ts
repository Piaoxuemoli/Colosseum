/** Parser for moderator narrations. Lives outside the main ResponseParser
 *  contract because moderators don't produce actions. */

const NARRATION_MAX = 120

export interface ModeratorParseResult {
  narration: string
  error?: 'narration-tag-missing' | 'too-long'
}

export function parseModeratorResponse(raw: string): ModeratorParseResult {
  const match = raw.match(/<narration[^>]*>([\s\S]*?)<\/narration>/i)
  if (!match) {
    // Fallback: use the whole raw text, truncated. This keeps the match
    // running even if the LLM ignores the tag contract.
    return { narration: raw.trim().slice(0, 80), error: 'narration-tag-missing' }
  }
  const text = match[1].trim()
  if (text.length > NARRATION_MAX) {
    return { narration: text.slice(0, NARRATION_MAX), error: 'too-long' }
  }
  return { narration: text }
}
