import { beforeAll, describe, expect, it } from 'vitest'
import { signMatchTokenHmac, verifyMatchTokenHmac } from '@/lib/auth/match-token'

describe('HMAC match-token', () => {
  beforeAll(() => {
    process.env.MATCH_TOKEN_SECRET = 'test-secret-0123456789abcdef'
  })

  it('signs and verifies', () => {
    const t = signMatchTokenHmac('m1', 60)
    expect(verifyMatchTokenHmac(t, 'm1')).toBe(true)
  })

  it('rejects wrong matchId', () => {
    const t = signMatchTokenHmac('m1', 60)
    expect(verifyMatchTokenHmac(t, 'm2')).toBe(false)
  })

  it('rejects expired token', () => {
    const t = signMatchTokenHmac('m1', -10)
    expect(verifyMatchTokenHmac(t, 'm1')).toBe(false)
  })

  it('rejects tampered signature', () => {
    const t = signMatchTokenHmac('m1', 60)
    const tampered = t.slice(0, -4) + 'abcd'
    expect(verifyMatchTokenHmac(tampered, 'm1')).toBe(false)
  })

  it('rejects malformed token', () => {
    expect(verifyMatchTokenHmac('', 'm1')).toBe(false)
    expect(verifyMatchTokenHmac('only-two.parts', 'm1')).toBe(false)
    expect(verifyMatchTokenHmac(null, 'm1')).toBe(false)
  })

  it('rejects short / non-base64url signature without crashing', () => {
    const now = Math.floor(Date.now() / 1000) + 60
    // a valid-looking token but the signature is only 4 chars (decodes to 3 bytes)
    expect(verifyMatchTokenHmac(`m1.${now}.abcd`, 'm1')).toBe(false)
    // tokens with illegal base64url characters decode to a shorter buffer
    expect(verifyMatchTokenHmac(`m1.${now}.!!!invalid!!!`, 'm1')).toBe(false)
  })

  it('throws when MATCH_TOKEN_SECRET is missing', () => {
    const prev = process.env.MATCH_TOKEN_SECRET
    delete process.env.MATCH_TOKEN_SECRET
    try {
      expect(() => signMatchTokenHmac('m1')).toThrow(/MATCH_TOKEN_SECRET/)
    } finally {
      process.env.MATCH_TOKEN_SECRET = prev
    }
  })
})
