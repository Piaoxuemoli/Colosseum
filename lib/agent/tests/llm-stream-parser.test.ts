import { describe, expect, it } from 'vitest'
import { LlmStreamParser } from '@/lib/agent/llm-stream-parser'

describe('LlmStreamParser', () => {
  it('parses a single chunk with thinking and action', () => {
    const parser = new LlmStreamParser()
    const events = [
      ...parser.feed('<thinking>abc</thinking><action>{"type":"fold"}</action>'),
      ...parser.end(),
    ]

    expect(events.find((event) => event.kind === 'thinking_delta')).toEqual({ kind: 'thinking_delta', text: 'abc' })
    expect(events.find((event) => event.kind === 'thinking_end')).toBeTruthy()
    expect(events.find((event) => event.kind === 'action')).toEqual({ kind: 'action', action: { type: 'fold' } })
  })

  it('splits thinking across many chunks', () => {
    const parser = new LlmStreamParser()
    const collected: string[] = []

    for (const chunk of ['<think', 'ing>hello ', 'world</thi', 'nking><action>{"type":"check"}</action>']) {
      for (const event of parser.feed(chunk)) {
        if (event.kind === 'thinking_delta') collected.push(event.text)
      }
    }

    for (const event of parser.end()) {
      if (event.kind === 'thinking_delta') collected.push(event.text)
    }

    expect(collected.join('')).toBe('hello world')
  })

  it('handles case-insensitive tags and spaced closing tags', () => {
    const parser = new LlmStreamParser()
    const events = parser.feed('<THINKING>x</ thinking><ACTION>{"type":"call","amount":2}</ACTION>')

    expect(events.find((event) => event.kind === 'thinking_delta')).toEqual({ kind: 'thinking_delta', text: 'x' })
    expect(events.find((event) => event.kind === 'action')).toEqual({
      kind: 'action',
      action: { type: 'call', amount: 2 },
    })
  })

  it('reports json_parse error on bad json', () => {
    const parser = new LlmStreamParser()
    const events = parser.feed('<action>{not json</action>')

    expect(events.find((event) => event.kind === 'action')).toEqual({
      kind: 'action',
      action: { error: 'json_parse', raw: '{not json' },
    })
  })

  it('flushes unterminated thinking and action on end', () => {
    const parser = new LlmStreamParser()
    const events = [...parser.feed('<thinking>still thinking'), ...parser.end()]

    expect(events).toEqual([
      { kind: 'thinking_delta', text: 'still thinking' },
      { kind: 'thinking_end' },
    ])

    const actionParser = new LlmStreamParser()
    expect([...actionParser.feed('<action>{"type":"bet","amount":4}'), ...actionParser.end()]).toContainEqual({
      kind: 'action',
      action: { type: 'bet', amount: 4 },
    })
  })
})
