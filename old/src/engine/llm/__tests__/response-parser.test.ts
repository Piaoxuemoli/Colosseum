import { describe, it, expect } from 'vitest'
import { parseThinkingAndAction, validateAction, parseImpressions } from '../../../games/poker/agent/poker-parser'
import type { AvailableAction } from '../../../games/poker/engine/poker-engine'

describe('parseThinkingAndAction', () => {
  it('parses well-formed response with thinking and action', () => {
    const response = `<thinking>The pot is large and I have top pair. I should raise to protect my hand.</thinking>
<action>{"type":"raise","amount":200}</action>`

    const result = parseThinkingAndAction(response)
    expect(result).not.toBeNull()
    expect(result!.thinking).toContain('top pair')
    expect(result!.action.type).toBe('raise')
    expect(result!.action.amount).toBe(200)
  })

  it('parses response with only action (no thinking)', () => {
    const response = `<action>{"type":"fold","amount":0}</action>`
    const result = parseThinkingAndAction(response)
    expect(result).not.toBeNull()
    expect(result!.thinking).toBe('')
    expect(result!.action.type).toBe('fold')
  })

  it('parses fallback JSON without tags', () => {
    const response = `I'll fold. {"type":"fold","amount":0}`
    const result = parseThinkingAndAction(response)
    expect(result).not.toBeNull()
    expect(result!.action.type).toBe('fold')
  })

  it('returns null for unparseable response', () => {
    const response = `I think I should call but I'm not sure.`
    const result = parseThinkingAndAction(response)
    expect(result).toBeNull()
  })

  it('parses action with missing amount (defaults to 0)', () => {
    const response = `<action>{"type":"check"}</action>`
    const result = parseThinkingAndAction(response)
    expect(result).not.toBeNull()
    expect(result!.action.type).toBe('check')
    expect(result!.action.amount).toBe(0)
  })

  it('parses plain action name: fold', () => {
    const response = `<thinking>手牌太差</thinking><action>fold</action>`
    const result = parseThinkingAndAction(response)
    expect(result).not.toBeNull()
    expect(result!.thinking).toContain('手牌太差')
    expect(result!.action.type).toBe('fold')
    expect(result!.action.amount).toBe(0)
  })

  it('parses plain action name: call', () => {
    const response = `<thinking>跟注看牌</thinking><action>call</action>`
    const result = parseThinkingAndAction(response)
    expect(result).not.toBeNull()
    expect(result!.action.type).toBe('call')
    expect(result!.action.amount).toBe(0)
  })

  it('parses plain action name: raise', () => {
    const response = `<action>raise</action>`
    const result = parseThinkingAndAction(response)
    expect(result).not.toBeNull()
    expect(result!.action.type).toBe('raise')
    expect(result!.action.amount).toBe(0)
  })

  it('parses plain action name: check', () => {
    const response = `<action>check</action>`
    const result = parseThinkingAndAction(response)
    expect(result).not.toBeNull()
    expect(result!.action.type).toBe('check')
  })

  it('parses plain action name: bet', () => {
    const response = `<action>bet</action>`
    const result = parseThinkingAndAction(response)
    expect(result).not.toBeNull()
    expect(result!.action.type).toBe('bet')
  })

  it('still parses JSON format for backward compatibility', () => {
    const response = `<action>{"type":"raise","amount":200}</action>`
    const result = parseThinkingAndAction(response)
    expect(result).not.toBeNull()
    expect(result!.action.type).toBe('raise')
    expect(result!.action.amount).toBe(200)
  })

  it('handles multiline thinking', () => {
    const response = `<thinking>
Line 1: Analysis
Line 2: More analysis
</thinking>
<action>{"type":"call","amount":100}</action>`

    const result = parseThinkingAndAction(response)
    expect(result).not.toBeNull()
    expect(result!.thinking).toContain('Line 1')
    expect(result!.thinking).toContain('Line 2')
  })
})

describe('validateAction', () => {
  const validActions: AvailableAction[] = [
    { type: 'fold' },
    { type: 'call', minAmount: 100, maxAmount: 100 },
    { type: 'raise', minAmount: 200, maxAmount: 1000 },
    { type: 'allIn', minAmount: 1000, maxAmount: 1000 },
  ]

  it('accepts valid fold', () => {
    const result = validateAction({ type: 'fold', amount: 0 }, validActions)
    expect(result).toEqual({ type: 'fold', amount: 0 })
  })

  it('accepts valid call', () => {
    const result = validateAction({ type: 'call', amount: 100 }, validActions)
    expect(result).toEqual({ type: 'call', amount: 100 })
  })

  it('clamps raise amount to min', () => {
    const result = validateAction({ type: 'raise', amount: 50 }, validActions)
    expect(result).not.toBeNull()
    expect(result!.type).toBe('raise')
    expect(result!.amount).toBeGreaterThanOrEqual(200)
  })

  it('clamps raise amount to max', () => {
    const result = validateAction({ type: 'raise', amount: 5000 }, validActions)
    expect(result).not.toBeNull()
    expect(result!.type).toBe('raise')
    expect(result!.amount).toBeLessThanOrEqual(1000)
  })

  it('maps bet to raise when only raise is available', () => {
    const result = validateAction({ type: 'bet', amount: 300 }, validActions)
    expect(result).not.toBeNull()
    expect(result!.type).toBe('raise')
  })

  it('maps check to call when check not available', () => {
    const result = validateAction({ type: 'check', amount: 0 }, validActions)
    expect(result).not.toBeNull()
    expect(result!.type).toBe('call')
  })

  it('returns null for completely invalid action', () => {
    const limitedActions: AvailableAction[] = [
      { type: 'fold' },
      { type: 'call', minAmount: 100, maxAmount: 100 },
    ]
    const result = validateAction({ type: 'raise', amount: 500 }, limitedActions)
    // Since raise is not available and no bet either, should return null
    expect(result).toBeNull()
  })
})

describe('parseImpressions', () => {
  it('parses well-formed impressions', () => {
    const response = `<impressions>
- Alice: 紧凶风格，善于读牌
- Bob: 松凶玩家，经常诈唬
</impressions>`

    const result = parseImpressions(response, ['Alice', 'Bob'])
    expect(result).not.toBeNull()
    expect(result!['Alice']).toContain('紧凶风格')
    expect(result!['Bob']).toContain('松凶玩家')
  })

  it('truncates impressions to 20 chars', () => {
    const response = `<impressions>
- Alice: 这是一个非常非常非常非常非常长的印象描述超过二十个字符
</impressions>`

    const result = parseImpressions(response, ['Alice'])
    expect(result).not.toBeNull()
    expect(result!['Alice'].length).toBeLessThanOrEqual(20)
  })

  it('returns null for unparseable response', () => {
    const result = parseImpressions('No impressions here', ['Alice'])
    expect(result).toBeNull()
  })

  it('handles partial matches', () => {
    const response = `<impressions>
- Alice: 激进玩家
</impressions>`

    const result = parseImpressions(response, ['Alice', 'Bob'])
    expect(result).not.toBeNull()
    expect(result!['Alice']).toBeDefined()
    // Bob not matched, but result is still valid since at least one matched
  })
})
