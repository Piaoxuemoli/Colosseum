import { describe, expect, it } from 'vitest'
import type { ActionSpec } from '@/lib/engine/contracts'
import type { PokerAction } from '../../engine/poker-types'
import { PokerResponseParser } from '../response-parser'

const validActions: ActionSpec<PokerAction>[] = [
  { type: 'fold' },
  { type: 'call', minAmount: 4, maxAmount: 4 },
  { type: 'raise', minAmount: 6, maxAmount: 6 },
]

describe('PokerResponseParser', () => {
  it('parses clean <action>call</action>', () => {
    const result = new PokerResponseParser().parse('<thinking>analyze</thinking><action>call</action>', validActions)

    expect((result.action as PokerAction).type).toBe('call')
    expect(result.thinking).toContain('analyze')
    expect(result.fallbackUsed).toBe(false)
  })

  it('bet maps to raise when raise is the valid aggressive action', () => {
    const result = new PokerResponseParser().parse('<action>bet</action>', validActions)
    expect((result.action as PokerAction).type).toBe('raise')
  })

  it('garbage text triggers fallback to fold', () => {
    const result = new PokerResponseParser().parse('hello world no tags', validActions)
    expect((result.action as PokerAction).type).toBe('fold')
    expect(result.fallbackUsed).toBe(true)
  })

  it('extracts thinking even without action tag', () => {
    const result = new PokerResponseParser().parse('<thinking>only analysis</thinking>', validActions)
    expect(result.thinking).toContain('only analysis')
    expect(result.fallbackUsed).toBe(true)
  })
})
