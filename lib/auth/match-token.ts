import { createHmac, timingSafeEqual } from 'node:crypto'

function secretBytes(): Buffer {
  const s = process.env.MATCH_TOKEN_SECRET
  if (!s) {
    throw new Error('MATCH_TOKEN_SECRET env var is required for HMAC match tokens')
  }
  return Buffer.from(s, 'utf8')
}

/**
 * Produce a stateless HMAC-signed match token bound to a single matchId +
 * expiration. Unlike the Redis-backed random token used by
 * `lib/orchestrator/match-token.ts`, this one survives a process restart and
 * works across multiple server instances (Phase 2-2 concurrency prereq).
 *
 * Format: `<matchId>.<expUnixSec>.<base64url(hmac-sha256)>`.
 */
export function signMatchTokenHmac(matchId: string, ttlSec = 2 * 60 * 60): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSec
  const payload = `${matchId}.${exp}`
  const sig = createHmac('sha256', secretBytes()).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

export function verifyMatchTokenHmac(
  token: string | null | undefined,
  matchId: string,
): boolean {
  if (!token) return false
  const parts = token.split('.')
  if (parts.length !== 3) return false
  const [mid, expStr, sig] = parts
  if (mid !== matchId) return false
  const exp = Number(expStr)
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false
  const expected = createHmac('sha256', secretBytes())
    .update(`${mid}.${expStr}`)
    .digest()
  // Decode the provided signature as base64url *raw bytes* so the constant-time
  // comparison is over 32 bytes of HMAC rather than the ASCII representation.
  // `Buffer.from(str, 'base64url')` tolerates missing padding and rejects
  // invalid characters by producing a shorter buffer, which the length check
  // catches before timingSafeEqual runs.
  let provided: Buffer
  try {
    provided = Buffer.from(sig, 'base64url')
  } catch {
    return false
  }
  if (provided.length !== expected.length) return false
  return timingSafeEqual(provided, expected)
}
