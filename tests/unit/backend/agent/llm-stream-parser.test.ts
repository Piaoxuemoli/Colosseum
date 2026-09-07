import { describe, expect, it } from 'vitest'
import { LlmStreamParser } from '@/backend/agent/llm-stream-parser'
import type { ParserEvent } from '@/backend/agent/llm-stream-parser'

/** Feed every chunk then flush, returning the full event stream. */
function run(chunks: string[]): ParserEvent[] {
  const parser = new LlmStreamParser()
  const events: ParserEvent[] = []
  for (const chunk of chunks) events.push(...parser.feed(chunk))
  events.push(...parser.end())
  return events
}

function thinkingText(events: ParserEvent[]): string {
  return events
    .filter((event): event is Extract<ParserEvent, { kind: 'thinking_delta' }> => event.kind === 'thinking_delta')
    .map((event) => event.text)
    .join('')
}

function rawText(events: ParserEvent[]): string {
  return events
    .filter((event): event is Extract<ParserEvent, { kind: 'raw' }> => event.kind === 'raw')
    .map((event) => event.text)
    .join('')
}

function actions(events: ParserEvent[]): unknown[] {
  return events
    .filter((event): event is Extract<ParserEvent, { kind: 'action' }> => event.kind === 'action')
    .map((event) => event.action)
}

describe('LlmStreamParser — thinking assembly', () => {
  it('parses a single chunk containing thinking and action', () => {
    const events = run(['<thinking>abc</thinking><action>{"type":"fold"}</action>'])
    expect(events).toEqual([
      { kind: 'thinking_delta', text: 'abc' },
      { kind: 'thinking_end' },
      { kind: 'action', action: { type: 'fold' } },
    ])
  })

  it('splits thinking across many arbitrary chunks', () => {
    const chunks = ['<think', 'ing>hello ', 'world</thi', 'nking><action>{"type":"check"}</action>']
    const events = run(chunks)
    expect(thinkingText(events)).toBe('hello world')
    expect(events).toContainEqual({ kind: 'thinking_end' })
    expect(actions(events)).toEqual([{ type: 'check' }])
  })

  it('reassembles thinking when fed one character at a time', () => {
    const text = '<thinking>deep reasoning here</thinking><action>{"type":"call","amount":2}</action>'
    const events = run(text.split(''))
    expect(thinkingText(events)).toBe('deep reasoning here')
    expect(rawText(events)).toBe('')
    expect(actions(events)).toEqual([{ type: 'call', amount: 2 }])
  })

  it('recognizes the native <think> tag used by MiniMax/DeepSeek reasoners', () => {
    const events = run(['<think>internal monologue</think>', '<action>{"type":"call","amount":2}</action>'])
    expect(thinkingText(events)).toBe('internal monologue')
    expect(actions(events)).toEqual([{ type: 'call', amount: 2 }])
  })

  it('handles case-insensitive tags and spaced closing tags', () => {
    const events = run(['<THINKING>x</ thinking><ACTION>{"type":"call","amount":2}</ACTION>'])
    expect(events).toEqual([
      { kind: 'thinking_delta', text: 'x' },
      { kind: 'thinking_end' },
      { kind: 'action', action: { type: 'call', amount: 2 } },
    ])
  })

  it('withholds a partial closing tag from the thinking stream until it resolves', () => {
    const body = 'A'.repeat(30)
    const parser = new LlmStreamParser()
    const first = parser.feed(`<thinking>${body}`)
    // The tail is held back in case it turns out to be a closing tag.
    for (const event of first) {
      expect(event.kind).not.toBe('raw')
      if (event.kind === 'thinking_delta') expect(event.text).not.toContain('<')
    }
    const rest = [...parser.feed('</thinking>'), ...parser.end()]
    expect(thinkingText([...first, ...rest])).toBe(body)
    expect(rest).toContainEqual({ kind: 'thinking_end' })
  })

  it('flushes unterminated thinking on end()', () => {
    expect(run(['<thinking>still thinking'])).toEqual([
      { kind: 'thinking_delta', text: 'still thinking' },
      { kind: 'thinking_end' },
    ])
  })

  it('emits thinking deltas before thinking_end and the action last', () => {
    const events = run(['<thinking>why</thinking><action>{"type":"fold"}</action>'])
    expect(events.map((event) => event.kind)).toEqual(['thinking_delta', 'thinking_end', 'action'])
  })
})

describe('LlmStreamParser — action extraction', () => {
  it('parses plain JSON actions', () => {
    expect(actions(run(['<action>{"type":"bet","amount":4}</action>']))).toEqual([{ type: 'bet', amount: 4 }])
  })

  it('unwraps an action nested under an "action" field', () => {
    const events = run(['<action>{"action":{"type":"raise","toAmount":80}}</action>'])
    expect(actions(events)).toEqual([{ type: 'raise', toAmount: 80 }])
  })

  it('unwraps the nested action even with extra sibling fields', () => {
    const events = run(['<action>{"confidence":0.9,"action":{"type":"fold"}}</action>'])
    expect(actions(events)).toEqual([{ type: 'fold' }])
  })

  it('accepts the answer/output/response fallback tags', () => {
    for (const tag of ['answer', 'output', 'response']) {
      const events = run([`<${tag}>{"type":"check"}</${tag}>`])
      expect(actions(events)).toEqual([{ type: 'check' }])
    }
  })

  it('rescues a markdown ```json code fence inside the action tag', () => {
    const events = run(['<action>```json\n{"type":"raise","toAmount":120}\n```</action>'])
    expect(actions(events)).toEqual([{ type: 'raise', toAmount: 120 }])
  })

  it('rescues a bare markdown code fence inside the action tag', () => {
    const events = run(['<action>```\n{"type":"fold"}\n```</action>'])
    expect(actions(events)).toEqual([{ type: 'fold' }])
  })

  it('salvages JSON wrapped in prose inside the action tag', () => {
    const events = run(['<action>My move is: {"type":"fold"} — good luck all.</action>'])
    expect(actions(events)).toEqual([{ type: 'fold' }])
  })

  it('reports a json_parse error object when nothing is salvageable', () => {
    const events = run(['<action>{not json</action>'])
    expect(events).toEqual([{ kind: 'action', action: { error: 'json_parse', raw: '{not json' } }])
  })

  it('emits exactly one action event even after end() rescue logic runs', () => {
    const events = run(['<action>{"type":"fold"}</action>'])
    expect(events.filter((event) => event.kind === 'action')).toHaveLength(1)
  })
})

describe('LlmStreamParser — truncated stream salvage', () => {
  it('salvages a truncated poker action from an unterminated action tag', () => {
    const events = run(['<action>{"type":"bet","amount":4}'])
    expect(actions(events)).toEqual([{ type: 'bet', amount: 4 }])
  })

  it('salvages a truncated raise toAmount', () => {
    const events = run(['<action>{"type":"raise","toAmount":120'])
    expect(actions(events)).toEqual([{ type: 'raise', toAmount: 120 }])
  })

  it('salvages a bare type when the stream dies right after it', () => {
    const events = run(['<action>{"type":"fold",'])
    expect(actions(events)).toEqual([{ type: 'fold' }])
  })

  it('salvages and normalizes a truncated werewolf kill with its target', () => {
    const events = run(['<action>{"type":"kill","targetId":"agt_2"'])
    expect(actions(events)).toEqual([{ type: 'night/werewolfKill', targetId: 'agt_2' }])
  })

  it('salvages a truncated werewolf speak with content and empty reasoning', () => {
    const events = run(['<action>{"type":"day/speak","content":"I am the seer","reasoning":"'])
    expect(actions(events)).toEqual([{ type: 'day/speak', content: 'I am the seer', reasoning: '' }])
  })

  it('keeps a null targetId in a truncated werewolf poison', () => {
    const events = run(['<action>{"type":"night/witchPoison","targetId":null,'])
    expect(actions(events)).toEqual([{ type: 'night/witchPoison', targetId: null }])
  })
})

describe('LlmStreamParser — end() transcript rescue', () => {
  it('rescues a bare JSON decision from a tag-less transcript', () => {
    const events = run(['I will fold now.\n{"type":"fold"}'])
    expect(rawText(events)).toBe('I will fold now.\n{"type":"fold"}')
    expect(actions(events)).toEqual([{ type: 'fold' }])
  })

  it('prefers the last candidate JSON a reasoner emitted', () => {
    const transcript = 'maybe fold {"type":"fold"} … actually {"type":"call","amount":10} is better'
    expect(actions(run([transcript]))).toEqual([{ type: 'call', amount: 10 }])
  })

  it('rescues from a trailing markdown code fence when no tags were used', () => {
    const events = run(['long reasoning …\n```json\n{"type":"check"}\n```\ndone'])
    expect(actions(events)).toEqual([{ type: 'check' }])
  })

  it('does not invent an action when the transcript has no decision JSON', () => {
    const events = run(['<thinking>only thinking, no decision</thinking>'])
    expect(actions(events)).toEqual([])
  })
})

describe('LlmStreamParser — raw passthrough', () => {
  it('emits raw events for text outside tags, preserving order', () => {
    const events = run(['before <thinking>x</thinking> after <action>{"type":"check"}</action>'])
    expect(events).toEqual([
      { kind: 'raw', text: 'before ' },
      { kind: 'thinking_delta', text: 'x' },
      { kind: 'thinking_end' },
      { kind: 'raw', text: ' after ' },
      { kind: 'action', action: { type: 'check' } },
    ])
  })

  it('holds back a stray partial tag from the raw stream until the next chunk resolves it', () => {
    const parser = new LlmStreamParser()
    const first = parser.feed('hello <not-a-t')
    expect(first).toEqual([{ kind: 'raw', text: 'hello ' }])
    const rest = [...parser.feed('ag but no tag'), ...parser.end()]
    expect(rawText([...first, ...rest])).toBe('hello <not-a-tag but no tag')
  })
})
