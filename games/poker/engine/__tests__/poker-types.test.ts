import { describe, expect, it } from 'vitest'
import { pokerActionSchema } from '../poker-types'

describe('pokerActionSchema', () => {
  it('accepts fold', () => {
    expect(pokerActionSchema.safeParse({ type: 'fold' }).success).toBe(true)
  })

  it('accepts raise with toAmount', () => {
    expect(pokerActionSchema.safeParse({ type: 'raise', toAmount: 10 }).success).toBe(true)
  })

  it('rejects raise without toAmount', () => {
    expect(pokerActionSchema.safeParse({ type: 'raise' }).success).toBe(false)
  })

  it('rejects negative call amount', () => {
    expect(pokerActionSchema.safeParse({ type: 'call', amount: -1 }).success).toBe(false)
  })

  it('rejects unknown type', () => {
    expect(pokerActionSchema.safeParse({ type: 'bogus' }).success).toBe(false)
  })
})
