/**
 * Map an agent-reported errorCode (which may be any string returned by a
 * remote endpoint) onto a bounded allowlist, so we don't leak unbounded
 * label cardinality into the metrics registry. Unknown strings become 'other'.
 */
export const KNOWN_FALLBACK_REASONS = new Set([
  'agent-token-missing',
  'agent-no-action',
  'agent-endpoint-failed',
  'agent-invalid-action',
  'agent-timeout',
  'agent-api_error',
  'agent-parse_fail',
  'agent-abort',
])

export function bucketizeFallbackReason(rawCode: string): string {
  return KNOWN_FALLBACK_REASONS.has(rawCode) ? rawCode : 'other'
}
