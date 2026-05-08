import { describe, expect, it } from 'vitest'
import { LlmStreamParser } from '@/lib/agent/llm-stream-parser'

/**
 * Regression coverage for reasoning models that don't follow our
 * <thinking>…</thinking><action>{…}</action> contract to the letter.
 *
 * Each case is a real-ish transcript we saw or that we expect from
 * MiniMax-M2.7 / DeepSeek-R1 / Doubao seed / Mimo reasoners.
 */
describe('LlmStreamParser — tolerant of reasoners', () => {
  function feed(chunks: string[]): { thinking: string; action: unknown | null } {
    const parser = new LlmStreamParser()
    let thinking = ''
    let action: unknown | null = null
    for (const chunk of chunks) {
      for (const event of parser.feed(chunk)) {
        if (event.kind === 'thinking_delta') thinking += event.text
        else if (event.kind === 'action') action = event.action
      }
    }
    for (const event of parser.end()) {
      if (event.kind === 'thinking_delta') thinking += event.text
      else if (event.kind === 'action') action = event.action
    }
    return { thinking, action }
  }

  it('<think>…</think> is treated like <thinking>', () => {
    const { thinking, action } = feed([
      '<think>ok</think><action>{"type":"fold"}</action>',
    ])
    expect(thinking).toBe('ok')
    expect(action).toEqual({ type: 'fold' })
  })

  it('rescues action from bare JSON object at end of thinking stream', () => {
    // Simulates MiniMax-M2.7 emitting only <think>…</think> and then
    // the raw final decision JSON with no <action> wrapper.
    const { action } = feed([
      '<think>long reasoning...\n',
      'I should call.</think>\n',
      '最终决策:{"type":"call","amount":4}',
    ])
    expect(action).toEqual({ type: 'call', amount: 4 })
  })

  it('rescues action from a ```json code fence at the end', () => {
    const { action } = feed([
      '<think>let me think</think>\nHere is my move:\n',
      '```json\n',
      '{"type":"raise","amount":12}\n',
      '```\n',
    ])
    expect(action).toEqual({ type: 'raise', amount: 12 })
  })

  it('prefers the last action-shaped JSON when several appear in thinking', () => {
    // Reasoning models often write candidate JSONs and then settle.
    const { action } = feed([
      '<think>Option A: {"type":"fold"} — weak. Option B: {"type":"call","amount":4}.',
      ' Going with the call.</think>',
    ])
    expect(action).toEqual({ type: 'call', amount: 4 })
  })

  it('accepts <answer>{…}</answer> as an alternate action tag', () => {
    const { action } = feed(['<think>x</think><answer>{"type":"check"}</answer>'])
    expect(action).toEqual({ type: 'check' })
  })

  it('accepts markdown fence inside the <action> tag', () => {
    const { action } = feed(['<action>\n```json\n{"type":"bet","amount":8}\n```\n</action>'])
    expect(action).toEqual({ type: 'bet', amount: 8 })
  })

  it('does not confuse a JSON object without a string type with an action', () => {
    const { action } = feed(['<think>{"foo":1}</think>{"cards":["7h","Js"]}'])
    expect(action).toBeNull()
  })

  it('still returns thinking_delta updates for the spectator bubble', () => {
    const parser = new LlmStreamParser()
    const deltas: string[] = []
    for (const chunk of ['<think>AAAAAAAAA', ' BBBBBBBBBBBBBBB', ' CCCCCCC</think>']) {
      for (const e of parser.feed(chunk)) {
        if (e.kind === 'thinking_delta') deltas.push(e.text)
      }
    }
    for (const e of parser.end()) {
      if (e.kind === 'thinking_delta') deltas.push(e.text)
    }
    expect(deltas.join('')).toBe('AAAAAAAAA BBBBBBBBBBBBBBB CCCCCCC')
  })

  it('tolerates mixed casing and whitespace on think/action tags', () => {
    const { thinking, action } = feed([
      '< THINK >x</ THINK >< Action >{"type":"fold"}</ Action >',
    ])
    expect(thinking).toBe('x')
    expect(action).toEqual({ type: 'fold' })
  })

  it('handles ugly truncation: no closing tag but JSON was produced mid-thinking', () => {
    // End of stream happens before the model emits </think>; we still want
    // to find the action JSON that appeared inside the reasoning text.
    const { action } = feed([
      '<think>weighing options. I will call with pot odds > 25%.',
      ' Final: {"type":"call","amount":4}',
    ])
    expect(action).toEqual({ type: 'call', amount: 4 })
  })
})
