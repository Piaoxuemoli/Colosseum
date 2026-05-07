/**
 * In-process counters + histograms, exposed via GET /api/metrics.
 *
 * Resets when the Next.js runtime restarts. Good enough for our single-node
 * deploy and for dev observability (Phase 2-2). A Prometheus adapter is
 * deferred until Phase 4/5.
 */

type Labels = Record<string, string>

const counters = new Map<string, number>()
const histograms = new Map<string, number[]>()

function labelKey(name: string, labels?: Labels): string {
  if (!labels) return name
  const ordered = Object.keys(labels)
    .sort()
    .map((k) => `${k}=${labels[k]}`)
    .join(',')
  return `${name}{${ordered}}`
}

export function inc(name: string, value = 1, labels?: Labels): void {
  const key = labelKey(name, labels)
  counters.set(key, (counters.get(key) ?? 0) + value)
}

export function observe(name: string, value: number, labels?: Labels): void {
  const key = labelKey(name, labels)
  const arr = histograms.get(key) ?? []
  arr.push(value)
  if (arr.length > 1000) arr.shift()
  histograms.set(key, arr)
}

export interface HistogramSnapshot {
  count: number
  avg: number
  p50: number
  p95: number
  p99: number
  min: number
  max: number
}

export interface MetricsSnapshot {
  counters: Record<string, number>
  histograms: Record<string, HistogramSnapshot>
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p))
  return sorted[idx]
}

export function snapshot(): MetricsSnapshot {
  const hist: Record<string, HistogramSnapshot> = {}
  for (const [k, arr] of histograms) {
    if (arr.length === 0) continue
    const sorted = [...arr].sort((a, b) => a - b)
    const sum = sorted.reduce((s, v) => s + v, 0)
    hist[k] = {
      count: sorted.length,
      avg: sum / sorted.length,
      p50: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
      p99: percentile(sorted, 0.99),
      min: sorted[0],
      max: sorted[sorted.length - 1],
    }
  }
  return {
    counters: Object.fromEntries(counters),
    histograms: hist,
  }
}

/** Test helper. Not exported via barrel. */
export function _resetMetrics(): void {
  counters.clear()
  histograms.clear()
}
