import { describe, expect, it } from 'vitest'
import { bucketizeFallbackReason, KNOWN_FALLBACK_REASONS } from '@/lib/orchestrator/fallback-reasons'

describe('bucketizeFallbackReason', () => {
  it('passes through known agent-* reasons', () => {
    expect(bucketizeFallbackReason('agent-token-missing')).toBe('agent-token-missing')
    expect(bucketizeFallbackReason('agent-no-action')).toBe('agent-no-action')
    expect(bucketizeFallbackReason('agent-endpoint-failed')).toBe('agent-endpoint-failed')
    expect(bucketizeFallbackReason('agent-invalid-action')).toBe('agent-invalid-action')
    expect(bucketizeFallbackReason('agent-timeout')).toBe('agent-timeout')
    expect(bucketizeFallbackReason('agent-api_error')).toBe('agent-api_error')
    expect(bucketizeFallbackReason('agent-parse_fail')).toBe('agent-parse_fail')
    expect(bucketizeFallbackReason('agent-abort')).toBe('agent-abort')
  })

  it('buckets anything unknown into "other" to bound cardinality', () => {
    expect(bucketizeFallbackReason('malicious-' + 'x'.repeat(100))).toBe('other')
    expect(bucketizeFallbackReason('')).toBe('other')
    expect(bucketizeFallbackReason('invalid-action')).toBe('other') // needs agent- prefix
    // Even synthesizing 10_000 attacker-controlled codes must only touch 1
    // additional label in the metric registry.
    const unique = new Set<string>()
    for (let i = 0; i < 10_000; i++) unique.add(bucketizeFallbackReason(`attacker-${i}`))
    expect(unique).toEqual(new Set(['other']))
  })

  it('allowlist stays aligned with decoded client errorKind values', () => {
    // These match the four LlmError kinds surfaced by lib/agent/llm-errors.ts.
    for (const k of ['timeout', 'api_error', 'parse_fail', 'abort']) {
      expect(KNOWN_FALLBACK_REASONS.has(`agent-${k}`)).toBe(true)
    }
  })
})
