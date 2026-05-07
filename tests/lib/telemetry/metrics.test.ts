import { describe, expect, it, beforeEach } from 'vitest'
import { inc, observe, snapshot, _resetMetrics } from '@/lib/telemetry/metrics'

describe('metrics', () => {
  beforeEach(() => _resetMetrics())

  it('counters accumulate and differentiate labels', () => {
    inc('req')
    inc('req')
    inc('req', 1, { path: '/x' })
    const s = snapshot()
    expect(s.counters.req).toBe(2)
    expect(s.counters['req{path=/x}']).toBe(1)
  })

  it('histograms compute count/avg/p50/p95/min/max', () => {
    for (const v of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) observe('lat', v)
    const s = snapshot()
    const h = s.histograms.lat
    expect(h.count).toBe(10)
    expect(h.avg).toBeCloseTo(5.5, 1)
    expect(h.min).toBe(1)
    expect(h.max).toBe(10)
    expect(h.p50).toBe(6)
    expect(h.p95).toBe(10)
  })

  it('labeled histogram keyed separately', () => {
    observe('latency', 100, { route: 'a' })
    observe('latency', 200, { route: 'b' })
    const s = snapshot()
    expect(Object.keys(s.histograms).sort()).toEqual([
      'latency{route=a}',
      'latency{route=b}',
    ])
  })

  it('rolls histogram at 1000 samples to bound memory', () => {
    for (let i = 0; i < 1500; i++) observe('big', i)
    const s = snapshot()
    expect(s.histograms.big.count).toBe(1000)
    expect(s.histograms.big.min).toBeGreaterThan(0)
  })
})
