import { describe, expect, it, beforeEach } from 'vitest'
import { GET } from '@/app/api/metrics/route'
import { inc, observe, _resetMetrics } from '@/lib/telemetry/metrics'

describe('GET /api/metrics', () => {
  beforeEach(() => _resetMetrics())

  it('returns counters + histograms snapshot', async () => {
    inc('tick.count', 3, { gameType: 'poker' })
    observe('agent.request_ms', 42)
    observe('agent.request_ms', 100)
    const res = await GET()
    const json = (await res.json()) as {
      counters: Record<string, number>
      histograms: Record<string, { count: number; avg: number }>
    }
    expect(json.counters['tick.count{gameType=poker}']).toBe(3)
    expect(json.histograms['agent.request_ms'].count).toBe(2)
    expect(json.histograms['agent.request_ms'].avg).toBeCloseTo(71, 0)
  })

  it('returns empty snapshot when nothing recorded', async () => {
    const res = await GET()
    const json = (await res.json()) as { counters: unknown; histograms: unknown }
    expect(json.counters).toEqual({})
    expect(json.histograms).toEqual({})
  })
})
