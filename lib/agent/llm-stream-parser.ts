export type ParserEvent =
  | { kind: 'thinking_delta'; text: string }
  | { kind: 'thinking_end' }
  | { kind: 'action'; action: unknown }
  | { kind: 'raw'; text: string }

type Mode = 'idle' | 'thinking' | 'action'

const SAFE_TAG_TAIL = 24

/**
 * Tags we recognize as "this region is the model's internal reasoning".
 * Different providers use different tags:
 *   - our context-builder asks for `<thinking>` explicitly
 *   - MiniMax reasoners emit `<think>...</think>` natively
 *   - DeepSeek reasoner also emits `<think>`
 * All are lumped together as "thinking" for the spectator bubble.
 */
const THINK_TAGS = ['thinking', 'think'] as const

/**
 * Tags we recognize as "this region is the final decision payload". First
 * option (`action`) is what our prompt asks for; the rest are fallbacks for
 * models that don't follow instructions perfectly.
 */
const ACTION_TAGS = ['action', 'answer', 'output', 'response'] as const

type ThinkTag = (typeof THINK_TAGS)[number]
type ActionTag = (typeof ACTION_TAGS)[number]
type TagName = ThinkTag | ActionTag

export class LlmStreamParser {
  private buffer = ''
  private mode: Mode = 'idle'
  private currentClosingTag: TagName | null = null
  /** Running copy of every character we've seen, used for `end()` fallback. */
  private transcript = ''
  /** True once we've emitted a valid action event. */
  private actionEmitted = false

  feed(chunk: string): ParserEvent[] {
    this.buffer += chunk
    this.transcript += chunk
    const events: ParserEvent[] = []

    while (true) {
      if (this.mode === 'idle') {
        if (!this.consumeNextStartTag(events)) break
        continue
      }

      if (this.mode === 'thinking') {
        if (!this.consumeThinking(events)) break
        continue
      }

      if (!this.consumeAction(events)) break
    }

    return events
  }

  end(): ParserEvent[] {
    const events: ParserEvent[] = []

    if (this.mode === 'thinking') {
      if (this.buffer.length > 0) events.push({ kind: 'thinking_delta', text: this.buffer })
      events.push({ kind: 'thinking_end' })
    } else if (this.mode === 'action') {
      this.emitAction(this.buffer.trim(), events)
    } else if (this.buffer.length > 0) {
      events.push({ kind: 'raw', text: this.buffer })
    }

    this.buffer = ''
    this.mode = 'idle'
    this.currentClosingTag = null

    // Best-effort rescue: if we never saw a proper <action>…</action> tag,
    // try to dig an action-shaped JSON object out of the whole transcript.
    // This is how we cope with "thinking" models that blow past the format
    // contract (e.g. MiniMax-M2.7, DeepSeek-R1 emitting bare `{type:..}` or
    // a markdown code block at the end).
    if (!this.actionEmitted) {
      const rescued = extractFinalActionJson(this.transcript)
      if (rescued !== null) {
        events.push({ kind: 'action', action: rescued })
        this.actionEmitted = true
      }
    }

    return events
  }

  private consumeNextStartTag(events: ParserEvent[]): boolean {
    const thinking = firstOpeningTag(this.buffer, THINK_TAGS)
    const action = firstOpeningTag(this.buffer, ACTION_TAGS)
    const next = firstTag(thinking, action)

    if (!next) {
      this.flushSafeRaw(events)
      return false
    }

    const raw = this.buffer.slice(0, next.index)
    if (raw.length > 0) events.push({ kind: 'raw', text: raw })
    this.buffer = this.buffer.slice(next.end)
    this.currentClosingTag = next.name
    this.mode = (THINK_TAGS as readonly string[]).includes(next.name) ? 'thinking' : 'action'
    return true
  }

  private consumeThinking(events: ParserEvent[]): boolean {
    if (!this.currentClosingTag) return false
    const end = findClosingTag(this.buffer, this.currentClosingTag)
    if (!end) {
      const safeLen = Math.max(0, this.buffer.length - SAFE_TAG_TAIL)
      if (safeLen > 0) {
        events.push({ kind: 'thinking_delta', text: this.buffer.slice(0, safeLen) })
        this.buffer = this.buffer.slice(safeLen)
      }
      return false
    }

    if (end.index > 0) events.push({ kind: 'thinking_delta', text: this.buffer.slice(0, end.index) })
    events.push({ kind: 'thinking_end' })
    this.buffer = this.buffer.slice(end.end)
    this.mode = 'idle'
    this.currentClosingTag = null
    return true
  }

  private consumeAction(events: ParserEvent[]): boolean {
    if (!this.currentClosingTag) return false
    const end = findClosingTag(this.buffer, this.currentClosingTag)
    if (!end) return false

    this.emitAction(this.buffer.slice(0, end.index).trim(), events)
    this.buffer = this.buffer.slice(end.end)
    this.mode = 'idle'
    this.currentClosingTag = null
    return true
  }

  private emitAction(body: string, events: ParserEvent[]): void {
    const stripped = stripMarkdownFence(body)
    try {
      events.push({ kind: 'action', action: JSON.parse(stripped) })
      this.actionEmitted = true
      return
    } catch {
      // Try to salvage a JSON object from the body; useful when the model
      // wrapped its answer in prose inside the <action> tag.
      const salvaged = extractFirstJsonObject(stripped)
      if (salvaged !== null) {
        events.push({ kind: 'action', action: salvaged })
        this.actionEmitted = true
        return
      }
      events.push({ kind: 'action', action: { error: 'json_parse', raw: body } })
    }
  }

  private flushSafeRaw(events: ParserEvent[]): void {
    const lastOpen = this.buffer.lastIndexOf('<')
    const safeLen = lastOpen === -1 ? this.buffer.length : lastOpen
    if (safeLen <= 0) return
    events.push({ kind: 'raw', text: this.buffer.slice(0, safeLen) })
    this.buffer = this.buffer.slice(safeLen)
  }
}

type FoundTag = { name: TagName; index: number; end: number }

function firstOpeningTag(buffer: string, candidates: readonly TagName[]): FoundTag | null {
  let best: FoundTag | null = null
  for (const name of candidates) {
    const match = new RegExp(`<\\s*${name}\\s*>`, 'i').exec(buffer)
    if (!match || match.index === undefined) continue
    if (best === null || match.index < best.index) {
      best = { name, index: match.index, end: match.index + match[0].length }
    }
  }
  return best
}

function findClosingTag(buffer: string, name: TagName): FoundTag | null {
  const match = new RegExp(`<\\s*/\\s*${name}\\s*>`, 'i').exec(buffer)
  if (!match || match.index === undefined) return null
  return { name, index: match.index, end: match.index + match[0].length }
}

function firstTag(...tags: Array<FoundTag | null>): FoundTag | null {
  return (
    tags.filter((tag): tag is FoundTag => tag !== null).sort((a, b) => a.index - b.index)[0] ?? null
  )
}

/**
 * Strip a ```json ... ``` (or ``` ... ```) code fence if the body is
 * wrapped in one. Many providers render their "final JSON" inside a
 * markdown fence regardless of our instructions.
 */
function stripMarkdownFence(body: string): string {
  const fenced = /^\s*```(?:json)?\s*([\s\S]*?)```\s*$/i.exec(body)
  if (fenced) return fenced[1].trim()
  return body
}

/**
 * Scan an arbitrary string for the first top-level JSON object that
 * matches the shape `{ "type": "...", ... }` and return it parsed. Used
 * as a last-resort rescue when a thinking model doesn't emit the tags we
 * asked for but *does* emit a decision JSON somewhere in its output.
 *
 * Why we prefer the *last* match: reasoners often write intermediate
 * candidate JSONs inside their reasoning (e.g. "maybe I should fold:
 * {type: 'fold'} — actually no, call: {type:'call'}"); the last one is
 * the final answer.
 */
function extractFinalActionJson(transcript: string): unknown | null {
  // Prefer code-fenced JSON if the model used one at the end.
  const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/gi
  const fences: string[] = []
  for (const m of transcript.matchAll(fenceRegex)) fences.push(m[1])
  for (let i = fences.length - 1; i >= 0; i--) {
    const parsed = tryParseAsAction(fences[i].trim())
    if (parsed !== null) return parsed
  }

  // Otherwise walk all balanced {...} spans and take the last type-bearing one.
  const objects = findBalancedBraceObjects(transcript)
  for (let i = objects.length - 1; i >= 0; i--) {
    const parsed = tryParseAsAction(objects[i])
    if (parsed !== null) return parsed
  }

  return null
}

function extractFirstJsonObject(body: string): unknown | null {
  const objects = findBalancedBraceObjects(body)
  for (const obj of objects) {
    try {
      return JSON.parse(obj)
    } catch {
      // keep scanning
    }
  }
  return null
}

/**
 * Walks the string and returns every top-level `{...}` span that parses
 * as JSON. Nested braces are handled by a simple depth counter (good
 * enough; full JSON parsing would be overkill for the typical input).
 */
function findBalancedBraceObjects(text: string): string[] {
  const out: string[] = []
  let depth = 0
  let start = -1
  let inString = false
  let stringQuote = ''
  let escaped = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === stringQuote) {
        inString = false
      }
      continue
    }
    if (ch === '"' || ch === "'") {
      inString = true
      stringQuote = ch
      continue
    }
    if (ch === '{') {
      if (depth === 0) start = i
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0 && start !== -1) {
        out.push(text.slice(start, i + 1))
        start = -1
      }
    }
  }
  return out
}

/**
 * Parse + sanity-check a JSON string as a poker / werewolf action. Accepts
 * any object with a string `type` (validation happens later in the game
 * engine). Returns null if it isn't parseable or doesn't smell like an
 * action.
 */
function tryParseAsAction(raw: string): unknown | null {
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && typeof (parsed as { type?: unknown }).type === 'string') {
      return parsed
    }
    return null
  } catch {
    return null
  }
}
