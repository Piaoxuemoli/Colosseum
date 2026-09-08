// PFR-102 / PFR-104：对局配置校验——非法配置开局前结构化拒绝，绝不发牌；v1 仅 no-limit 入口。

import { describe, expect, it } from 'vitest'
import { createMatch } from '@/games/poker/engine2'
import { mkConfig } from './testkit'

describe('PFR-102 配置校验', () => {
  it('人数为 1 或 10 → 拒绝（INVALID_CONFIG_SHAPE）', () => {
    expect(createMatch(mkConfig(['p0'], 100, 1, 2), 1).ok).toBe(false)
    const ten = createMatch(mkConfig(Array.from({ length: 10 }, (_, i) => `p${i}`), 100, 1, 2), 1)
    expect(ten.ok).toBe(false)
    if (!ten.ok) expect(ten.rejection.code).toBe('INVALID_CONFIG_SHAPE')
  })

  it('SB ≥ BB / 非正筹码 / 非整数 → 拒绝', () => {
    expect(createMatch(mkConfig(['p0', 'p1'], 100, 2, 2), 1).ok).toBe(false) // SB = BB
    expect(createMatch(mkConfig(['p0', 'p1'], 100, 3, 2), 1).ok).toBe(false) // SB > BB
    expect(createMatch(mkConfig(['p0', 'p1'], 0, 1, 2), 1).ok).toBe(false) // 非正筹码
    expect(createMatch(mkConfig(['p0', 'p1'], 50.5, 1, 2), 1).ok).toBe(false) // 非整数
  })

  it('重复座位 ID → 拒绝（DUPLICATE_SEAT_ID）', () => {
    const r = createMatch(mkConfig(['p0', 'p0'], 100, 1, 2), 1)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.rejection.code).toBe('DUPLICATE_SEAT_ID')
  })

  it('升级计划 levels[0] 与初始盲注不一致 → 拒绝（SCHEDULE_LEVEL_MISMATCH）', () => {
    const r = createMatch(
      mkConfig(['p0', 'p1'], 100, 1, 2, { handsPerLevel: 5, levels: [{ sb: 2, bb: 4 }, { sb: 4, bb: 8 }] }),
      1,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.rejection.code).toBe('SCHEDULE_LEVEL_MISMATCH')
  })

  it('升级间隔非正整数 → 拒绝；合法配置开局成功且首个事件为对局配置确立（公共）', () => {
    expect(
      createMatch(mkConfig(['p0', 'p1'], 100, 1, 2, { handsPerLevel: 0, levels: [{ sb: 1, bb: 2 }] }), 1).ok,
    ).toBe(false)

    const ok = createMatch(mkConfig(['p0', 'p1', 'p2'], 100, 1, 2, { handsPerLevel: 3, levels: [{ sb: 1, bb: 2 }, { sb: 2, bb: 4 }] }), 42)
    expect(ok.ok).toBe(true)
    if (!ok.ok) return
    expect(ok.events[0].kind).toBe('match-config')
    expect(ok.events[0].audience).toEqual({ kind: 'public' })
    expect(ok.events.filter((e) => e.kind === 'hole-cards-dealt')).toHaveLength(3) // 已发牌（合法配置进入发牌）
  })
})
