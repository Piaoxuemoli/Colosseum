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
})
