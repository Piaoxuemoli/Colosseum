import { describe, it, expect } from 'vitest'
import { checkWin, MAX_DAYS_BEFORE_TIE } from '@/games/werewolf/engine/win-condition'
import type { WerewolfState } from '@/games/werewolf/engine/types'
import { makeBaseState } from './_helpers'

/** 独立参考实现：与被测代码分开推导，用于置换扫描对照。 */
function oracle(aliveWerewolves: number, aliveVillagers: number, day: number) {
  if (aliveWerewolves === 0) return { settled: true, winner: 'villagers' as const }
  if (aliveVillagers === 0 || aliveWerewolves >= aliveVillagers) {
    return { settled: true, winner: 'werewolves' as const }
  }
  if (day >= MAX_DAYS_BEFORE_TIE) return { settled: true, winner: 'tie' as const }
  return { settled: false, winner: null }
}

function withDeaths(deadIds: string[]): WerewolfState {
  const dead = new Set(deadIds)
  const base = makeBaseState()
  return {
    ...base,
    players: base.players.map((p) => (dead.has(p.agentId) ? { ...p, alive: false } : p)),
  }
}

describe('checkWin — 基础判定', () => {
  it('狼人全灭 → 好人胜', () => {
    const s = withDeaths(['w1', 'w2'])
    expect(checkWin(s)).toEqual({ settled: true, winner: 'villagers' })
  })

  it('好人全灭 → 狼人胜', () => {
    const s = withDeaths(['s', 'wi', 'v1', 'v2'])
    expect(checkWin(s)).toEqual({ settled: true, winner: 'werewolves' })
  })

  it('狼人数 ≥ 好人数（均势）→ 狼人胜（2v2 / 1v1）', () => {
    expect(checkWin(withDeaths(['s', 'wi']))).toEqual({ settled: true, winner: 'werewolves' })
    expect(checkWin(withDeaths(['s', 'wi', 'v1', 'v2']))).toEqual({
      settled: true,
      winner: 'werewolves',
    })
    expect(checkWin(withDeaths(['wi', 'v1', 'v2', 'w2']))).toEqual({
      settled: true,
      winner: 'werewolves',
    })
  })

  it('狼人劣势 → 未结算（1v3 / 1v2 / 2v3）', () => {
    expect(checkWin(withDeaths(['w2']))).toEqual({ settled: false, winner: null })
    expect(checkWin(withDeaths(['w2', 'v2']))).toEqual({ settled: false, winner: null })
    expect(checkWin(withDeaths(['v2']))).toEqual({ settled: false, winner: null })
  })

  it('开局全员存活 → 未结算', () => {
    expect(checkWin(makeBaseState())).toEqual({ settled: false, winner: null })
  })
})

describe('checkWin — 死亡置换全扫描', () => {
  it('6 人局全部 64 种存活/死亡组合均与参考实现一致', () => {
    const ids = makeBaseState().players.map((p) => p.agentId)
    for (let mask = 0; mask < 2 ** ids.length; mask++) {
      const deadIds = ids.filter((_, bit) => mask & (1 << bit))
      const s = withDeaths(deadIds)
      const alive = s.players.filter((p) => p.alive)
      const wolves = alive.filter((p) => s.roleAssignments[p.agentId] === 'werewolf').length
      const villagers = alive.length - wolves
      const day = mask % 10 // 顺带变化天数，覆盖 < 40 的多数取值
      expect(checkWin({ ...s, day })).toEqual(oracle(wolves, villagers, day))
    }
  })

  it('天数达到 40 且局面未分 → 平局；39 天仍继续', () => {
    const s = withDeaths(['w2', 'v2']) // 1 狼 vs 2 好人
    expect(checkWin({ ...s, day: 39 })).toEqual({ settled: false, winner: null })
    expect(checkWin({ ...s, day: MAX_DAYS_BEFORE_TIE })).toEqual({ settled: true, winner: 'tie' })
    expect(checkWin({ ...s, day: 60 })).toEqual({ settled: true, winner: 'tie' })
  })

  it('阵营胜负优先于天数十限（狼全灭在 day 40 仍是好人胜）', () => {
    const s = withDeaths(['w1', 'w2'])
    expect(checkWin({ ...s, day: MAX_DAYS_BEFORE_TIE })).toEqual({
      settled: true,
      winner: 'villagers',
    })
    const s2 = withDeaths(['s', 'wi', 'v1', 'v2'])
    expect(checkWin({ ...s2, day: MAX_DAYS_BEFORE_TIE })).toEqual({
      settled: true,
      winner: 'werewolves',
    })
  })
})

describe('MAX_DAYS_BEFORE_TIE', () => {
  it('十限为 40 天（spec 约定）', () => {
    expect(MAX_DAYS_BEFORE_TIE).toBe(40)
  })
})
