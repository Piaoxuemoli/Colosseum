import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { log } from '@/lib/telemetry/logger'

describe('lib/telemetry/logger', () => {
  let spy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    spy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    spy.mockRestore()
  })

  it('emits a JSON line to stdout with level=info', () => {
    log.info('hello', { matchId: 'm1' })
    expect(spy).toHaveBeenCalledOnce()
    const arg = spy.mock.calls[0][0] as string
    const parsed = JSON.parse(arg) as { level: string; msg: string; matchId: string; ts: string }

    expect(parsed.level).toBe('info')
    expect(parsed.msg).toBe('hello')
    expect(parsed.matchId).toBe('m1')
    expect(typeof parsed.ts).toBe('string')
  })

  it('emits level=error on .error', () => {
    log.error('boom', { errorCode: 'xyz' })
    const arg = spy.mock.calls[0][0] as string
    expect((JSON.parse(arg) as { level: string }).level).toBe('error')
  })

  it('withMatch scopes subsequent calls', () => {
    const sub = log.withMatch('match_abc', { run: 1 })
    sub.info('tick', { phase: 'deal' })
    const arg = spy.mock.calls[0][0] as string
    const parsed = JSON.parse(arg) as Record<string, unknown>
    expect(parsed.matchId).toBe('match_abc')
    expect(parsed.run).toBe(1)
    expect(parsed.phase).toBe('deal')
  })

  it('respects LOG_LEVEL env to suppress lower levels', () => {
    const prev = process.env.LOG_LEVEL
    process.env.LOG_LEVEL = 'warn'
    try {
      log.info('should be dropped')
      log.warn('kept')
      expect(spy).toHaveBeenCalledOnce()
      const line = spy.mock.calls[0][0] as string
      expect(line).toContain('kept')
    } finally {
      process.env.LOG_LEVEL = prev
    }
  })
})
