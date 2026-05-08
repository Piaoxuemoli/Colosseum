import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast, useToastStore } from '@/lib/client/toast'

describe('toast store', () => {
  beforeEach(() => {
    useToastStore.setState({ items: [] })
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('push appends a toast and returns an id', () => {
    const id = toast.error('请求失败', 'boom')
    const items = useToastStore.getState().items
    expect(items).toHaveLength(1)
    expect(items[0].id).toBe(id)
    expect(items[0].kind).toBe('error')
    expect(items[0].title).toBe('请求失败')
  })

  it('dismiss removes the toast immediately', () => {
    const id = toast.info('hello')
    useToastStore.getState().dismiss(id)
    expect(useToastStore.getState().items).toHaveLength(0)
  })

  it('auto-dismisses after ~5s', () => {
    toast.success('ok')
    expect(useToastStore.getState().items).toHaveLength(1)
    vi.advanceTimersByTime(5000)
    expect(useToastStore.getState().items).toHaveLength(0)
  })
})
