import { describe, it, expect } from 'vitest'
import {
  WEREWOLF_ROLE_COMPOSITION,
  assignRoles,
  factionOf,
  seededRng,
} from '@/games/werewolf/engine/roles'
import type { WerewolfRole } from '@/games/werewolf/engine/types'

const sixIds = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6']

/** Count how many agents received each role. */
function tally(assignments: Record<string, WerewolfRole>): Record<WerewolfRole, number> {
  const out = { werewolf: 0, seer: 0, witch: 0, villager: 0 }
  for (const role of Object.values(assignments)) out[role] += 1
  return out
}

describe('WEREWOLF_ROLE_COMPOSITION', () => {
  it('固定 6 人局配置：2 狼 · 1 预言家 · 1 女巫 · 2 平民', () => {
    expect(WEREWOLF_ROLE_COMPOSITION).toEqual({
      werewolf: 2,
      seer: 1,
      witch: 1,
      villager: 2,
    })
  })

  it('配置人数总和为 6', () => {
    const total = Object.values(WEREWOLF_ROLE_COMPOSITION).reduce((a, b) => a + b, 0)
    expect(total).toBe(6)
  })
})

describe('factionOf', () => {
  it('狼人属于狼阵营，其余属于好人阵营', () => {
    expect(factionOf('werewolf')).toBe('werewolves')
    expect(factionOf('seer')).toBe('villagers')
    expect(factionOf('witch')).toBe('villagers')
    expect(factionOf('villager')).toBe('villagers')
  })
})

describe('assignRoles', () => {
  it('6 人局产出符合配置的完整分配（数量/唯一性/覆盖）', () => {
    const assignments = assignRoles(sixIds, seededRng(123))
    expect(Object.keys(assignments).sort()).toEqual([...sixIds].sort())
    expect(tally(assignments)).toEqual(WEREWOLF_ROLE_COMPOSITION)
  })

  it('角色值全部在合法枚举内', () => {
    const assignments = assignRoles(sixIds, seededRng(7))
    const legal: WerewolfRole[] = ['werewolf', 'seer', 'witch', 'villager']
    for (const role of Object.values(assignments)) expect(legal).toContain(role)
  })

  it('同一 seed 下分配完全确定', () => {
    for (const seed of [0, 1, 42, 999]) {
      expect(assignRoles(sixIds, seededRng(seed))).toEqual(assignRoles(sixIds, seededRng(seed)))
    }
  })

  it('注入恒 0 rng 时洗牌退化为固定映射（rng 真正参与分布）', () => {
    const assignments = assignRoles(sixIds, () => 0)
    // Fisher–Yates 每步 j=0：池 [狼,狼,预,巫,平,平] 被逐步翻转为 [狼,预,巫,平,平,狼]
    expect(assignments).toEqual({
      a1: 'werewolf',
      a2: 'seer',
      a3: 'witch',
      a4: 'villager',
      a5: 'villager',
      a6: 'werewolf',
    })
  })

  it('不同 seed 的多次采样仍满足数量配置（分布不被 seed 破坏）', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      expect(tally(assignRoles(sixIds, seededRng(seed)))).toEqual(WEREWOLF_ROLE_COMPOSITION)
    }
  })

  it('非 6 人局抛错（5 / 7 / 0 人）', () => {
    expect(() => assignRoles(['a', 'b', 'c', 'd', 'e'])).toThrow('exactly 6')
    expect(() => assignRoles([...sixIds, 'a7'])).toThrow('exactly 6')
    expect(() => assignRoles([])).toThrow('exactly 6')
  })

  it('agent 顺序不改变角色池数量（重复 id 由调用方保证唯一）', () => {
    const reversed = assignRoles([...sixIds].reverse(), seededRng(5))
    expect(tally(reversed)).toEqual(WEREWOLF_ROLE_COMPOSITION)
  })
})

describe('seededRng', () => {
  it('输出落在 [0, 1) 区间', () => {
    const rng = seededRng(42)
    for (let i = 0; i < 1000; i++) {
      const v = rng()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('同 seed 序列一致，不同 seed 序列（几乎必然）不同', () => {
    const a1 = seededRng(1)
    const a2 = seededRng(1)
    const b = seededRng(2)
    const seqA1 = Array.from({ length: 5 }, () => a1())
    const seqA2 = Array.from({ length: 5 }, () => a2())
    const seqB = Array.from({ length: 5 }, () => b())
    expect(seqA1).toEqual(seqA2)
    expect(seqA1).not.toEqual(seqB)
  })
})
