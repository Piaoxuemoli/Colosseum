export type ParserEvent =
  | { kind: 'thinking_delta'; text: string }
  | { kind: 'thinking_end' }
  | { kind: 'action'; action: unknown }
  | { kind: 'raw'; text: string }

type Mode = 'idle' | 'thinking' | 'action'

const SAFE_TAG_TAIL = 24

export class LlmStreamParser {
  private buffer = ''
  private mode: Mode = 'idle'

  feed(chunk: string): ParserEvent[] {
    this.buffer += chunk
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
    return events
  }

  private consumeNextStartTag(events: ParserEvent[]): boolean {
    const thinking = findTag(this.buffer, 'thinking', false)
    const action = findTag(this.buffer, 'action', false)
    const next = firstTag(thinking, action)

    if (!next) {
      this.flushSafeRaw(events)
      return false
    }

    const raw = this.buffer.slice(0, next.index)
    if (raw.length > 0) events.push({ kind: 'raw', text: raw })
    this.buffer = this.buffer.slice(next.end)
    this.mode = next.name
    return true
  }

  private consumeThinking(events: ParserEvent[]): boolean {
    const end = findTag(this.buffer, 'thinking', true)
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
    return true
  }

  private consumeAction(events: ParserEvent[]): boolean {
    const end = findTag(this.buffer, 'action', true)
    if (!end) return false

    this.emitAction(this.buffer.slice(0, end.index).trim(), events)
    this.buffer = this.buffer.slice(end.end)
    this.mode = 'idle'
    return true
  }

  private emitAction(body: string, events: ParserEvent[]): void {
    try {
      events.push({ kind: 'action', action: JSON.parse(body) })
    } catch {
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

type FoundTag = { name: 'thinking' | 'action'; index: number; end: number }

function findTag(buffer: string, name: 'thinking' | 'action', closing: boolean): FoundTag | null {
  const slash = closing ? '\\/' : ''
  const pattern = new RegExp(`<\\s*${slash}\\s*${name}\\s*>`, 'i')
  const match = pattern.exec(buffer)
  if (!match || match.index === undefined) return null
  return { name, index: match.index, end: match.index + match[0].length }
}

function firstTag(...tags: Array<FoundTag | null>): FoundTag | null {
  return tags.filter((tag): tag is FoundTag => tag !== null).sort((a, b) => a.index - b.index)[0] ?? null
}
