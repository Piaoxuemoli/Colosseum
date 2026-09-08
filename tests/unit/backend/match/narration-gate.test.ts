import { describe, expect, it } from 'vitest'
import { isNarrationEnabled } from '@/backend/match/narration-gate'

describe('isNarrationEnabled (FR-4.7-01 解说旁白总闸)', () => {
  it('config 缺失 / null 时默认开启（向后兼容存量对局）', () => {
    expect(isNarrationEnabled(undefined)).toBe(true)
    expect(isNarrationEnabled(null)).toBe(true)
  })

  it('字段缺省时默认开启', () => {
    expect(isNarrationEnabled({})).toBe(true)
    expect(isNarrationEnabled({ agentTimeoutMs: 1000 })).toBe(true)
    expect(isNarrationEnabled({ narrationEnabled: undefined })).toBe(true)
  })

  it('显式 true 保持开启', () => {
    expect(isNarrationEnabled({ narrationEnabled: true })).toBe(true)
  })

  it('仅显式布尔 false 关闭旁白', () => {
    expect(isNarrationEnabled({ narrationEnabled: false })).toBe(false)
  })

  it('非布尔杂值不视为关闭（防止 JSON 反序列化意外静音）', () => {
    expect(isNarrationEnabled({ narrationEnabled: 'false' })).toBe(true)
    expect(isNarrationEnabled({ narrationEnabled: 0 })).toBe(true)
    expect(isNarrationEnabled({ narrationEnabled: null })).toBe(true)
  })
})
