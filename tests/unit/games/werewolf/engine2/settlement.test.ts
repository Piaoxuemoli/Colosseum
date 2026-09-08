// Pure ruling tables: night conflicts (WFR-402 incl. M2 guard rows),
// terminal evaluation (WFR-405), hunter ban matrix (params 16/17) and the
// last-words matrix (WFR-105). Guard scenarios are tested here directly —
// M1 boards cannot seat a guard, but the resolver implements the full table.

import { describe, expect, it } from 'vitest'
import { evaluateWin, hunterCanShoot, lastWordsEligible, resolveNight } from '@/games/werewolf/engine2'
import type { DeathCause, DeathRecord, RoleId } from '@/games/werewolf/engine2'

const night = (knifeTarget: string | null, witchSaveTarget: string | null = null, witchPoisonTarget: string | null = null, guardTarget: string | null = null) =>
  ({ knifeTarget, guardTarget, witchSaveTarget, witchPoisonTarget })

describe('WFR-402 night conflict table', () => {
  it('wolf kill alone → target dies by wolf-kill', () => {
    const r = resolveNight(night('a'), { guardSaveConflict: 'milk-pierce', guardBlocksPoison: false })
    expect(r.deaths).toEqual([{ playerId: 'a', causes: ['wolf-kill'] }])
  })

  it('wolf kill + witch save → target survives (AC-1 base)', () => {
    const r = resolveNight(night('a', 'a'), { guardSaveConflict: 'milk-pierce', guardBlocksPoison: false })
    expect(r.deaths).toEqual([])
    expect(r.facts).toContain('saved')
  })

  it('wolf kill + guard → target survives', () => {
    const r = resolveNight(night('a', null, null, 'a'), { guardSaveConflict: 'milk-pierce', guardBlocksPoison: false })
    expect(r.deaths).toEqual([])
    expect(r.facts).toContain('guarded')
  })

  it('wolf kill + guard + save → 奶穿: target dies (param 19 milk-pierce)', () => {
    const r = resolveNight(night('a', 'a', null, 'a'), { guardSaveConflict: 'milk-pierce', guardBlocksPoison: false })
    expect(r.deaths).toEqual([{ playerId: 'a', causes: ['wolf-kill', 'milk-pierce'] }])
    expect(r.facts).toContain('milk-pierce:same-guard-and-save')
  })

  it('wolf kill + guard + save with both-save policy → target survives', () => {
    const r = resolveNight(night('a', 'a', null, 'a'), { guardSaveConflict: 'both-save', guardBlocksPoison: false })
    expect(r.deaths).toEqual([])
  })

  it('poison pierces guard (毒穿, param 20 default)', () => {
    const r = resolveNight(night(null, null, 'b', 'b'), { guardSaveConflict: 'milk-pierce', guardBlocksPoison: false })
    expect(r.deaths).toEqual([{ playerId: 'b', causes: ['poison'] }])
  })

  it('guard blocks poison when param 20 is configured to block', () => {
    const r = resolveNight(night(null, null, 'b', 'b'), { guardSaveConflict: 'milk-pierce', guardBlocksPoison: true })
    expect(r.deaths).toEqual([])
    expect(r.facts).toContain('poison-blocked-by-guard')
  })

  it('knife and poison on different targets → double death', () => {
    const r = resolveNight(night('a', null, 'b'), { guardSaveConflict: 'milk-pierce', guardBlocksPoison: false })
    expect(r.deaths.map((d) => d.playerId)).toEqual(['a', 'b'])
  })

  it('knife and poison on the same target → dies once, both causes recorded', () => {
    const r = resolveNight(night('a', null, 'a'), { guardSaveConflict: 'milk-pierce', guardBlocksPoison: false })
    expect(r.deaths).toEqual([{ playerId: 'a', causes: ['wolf-kill', 'poison'] }])
    expect(r.facts).toContain('knife-and-poison-same-target')
  })

  it('empty kill → peaceful night', () => {
    const r = resolveNight(night(null), { guardSaveConflict: 'milk-pierce', guardBlocksPoison: false })
    expect(r.deaths).toEqual([])
    expect(r.facts).toEqual([])
  })
})

describe('WFR-405 terminal evaluation', () => {
  const alive = (...roles: RoleId[]) => roles.map((role, i) => ({ playerId: `x${i}`, role }))

  it('kill-side: all gods gone → wolves win', () => {
    const r = evaluateWin(alive('werewolf', 'villager', 'villager'), {
      winCondition: 'kill-side',
      wolfPriority: true,
    })
    expect(r).toEqual({ settled: true, winner: 'wolves', basis: 'kill-side:gods-eliminated' })
  })

  it('kill-side: all villagers gone → wolves win', () => {
    const r = evaluateWin(alive('werewolf', 'seer', 'witch'), {
      winCondition: 'kill-side',
      wolfPriority: true,
    })
    expect(r).toEqual({ settled: true, winner: 'wolves', basis: 'kill-side:villagers-eliminated' })
  })

  it('kill-side: one of each side alive → unsettled', () => {
    const r = evaluateWin(alive('werewolf', 'seer', 'villager'), {
      winCondition: 'kill-side',
      wolfPriority: true,
    })
    expect(r.settled).toBe(false)
  })

  it('kill-all: all good gone → wolves win even with gods/villagers split irrelevant', () => {
    const r = evaluateWin(alive('werewolf'), { winCondition: 'kill-all', wolfPriority: true })
    expect(r).toEqual({ settled: true, winner: 'wolves', basis: 'kill-all:no-good-alive' })
  })

  it('kill-all-parity: wolves >= good → wolves win fast path', () => {
    const r = evaluateWin(alive('werewolf', 'werewolf', 'seer'), {
      winCondition: 'kill-all-parity',
      wolfPriority: true,
    })
    expect(r).toEqual({ settled: true, winner: 'wolves', basis: 'kill-all-parity:wolves-no-fewer-than-good' })
  })

  it('all wolves eliminated → good wins in every mode', () => {
    for (const winCondition of ['kill-side', 'kill-all', 'kill-all-parity'] as const) {
      const r = evaluateWin(alive('seer', 'witch', 'villager'), { winCondition, wolfPriority: true })
      expect(r).toEqual({ settled: true, winner: 'good', basis: 'all-wolves-eliminated' })
    }
  })

  it('狼刀在先: both sides settle in one settlement → wolves win when param 3 is on', () => {
    // everyone dead: wolves=0 and good=0 simultaneously
    const r = evaluateWin([], { winCondition: 'kill-all', wolfPriority: true })
    expect(r).toEqual({ settled: true, winner: 'wolves', basis: 'kill-all:no-good-alive' })
  })

  it('param 3 off: same simultaneous settlement → good wins', () => {
    const r = evaluateWin([], { winCondition: 'kill-all', wolfPriority: false })
    expect(r).toEqual({ settled: true, winner: 'good', basis: 'all-wolves-eliminated' })
  })

  it('parity edge: wolves strictly fewer than good → unsettled', () => {
    const r = evaluateWin(alive('werewolf', 'seer', 'witch', 'villager'), {
      winCondition: 'kill-all-parity',
      wolfPriority: true,
    })
    expect(r.settled).toBe(false)
  })
})

describe('hunter ban matrix (params 16/17)', () => {
  const defaults = { hunterShootOnPoison: false, hunterShootOnMilkPierce: true }
  const causes = (...list: DeathCause[]) => list

  it('wolf-kill / exile / shot deaths allow shooting', () => {
    for (const c of [causes('wolf-kill'), causes('exile'), causes('shot')]) {
      expect(hunterCanShoot(c, defaults)).toBe(true)
    }
  })

  it('poisoned hunter cannot shoot by default (param 16 = 禁)', () => {
    expect(hunterCanShoot(causes('poison'), defaults)).toBe(false)
  })

  it('param 16 = 允 lets a poisoned hunter shoot', () => {
    expect(hunterCanShoot(causes('poison'), { ...defaults, hunterShootOnPoison: true })).toBe(true)
  })

  it('milk-pierced hunter can shoot by default (param 17)', () => {
    expect(hunterCanShoot(causes('wolf-kill', 'milk-pierce'), defaults)).toBe(true)
  })

  it('param 17 = 不可 bans the milk-pierced hunter', () => {
    expect(hunterCanShoot(causes('wolf-kill', 'milk-pierce'), { ...defaults, hunterShootOnMilkPierce: false })).toBe(false)
  })
})

describe('WFR-105 last-words matrix (param 8)', () => {
  const death = (over: Partial<DeathRecord>): DeathRecord => ({
    settledDay: 1,
    time: 'night',
    nightNumber: 1,
    causes: ['wolf-kill'],
    ...over,
  })
  const policy = 'first-night-and-day' as const

  it('first-night knife death → last words', () => {
    expect(lastWordsEligible(death({ nightNumber: 1, causes: ['wolf-kill'] }), policy)).toBe(true)
  })

  it('later-night knife death → no last words', () => {
    expect(lastWordsEligible(death({ nightNumber: 2, causes: ['wolf-kill'] }), policy)).toBe(false)
  })

  it('poisoned death (any night) → no last words', () => {
    expect(lastWordsEligible(death({ nightNumber: 1, causes: ['poison'] }), policy)).toBe(false)
  })

  it('night-time shot death (night-shooter) → no last words even on night 1', () => {
    expect(lastWordsEligible(death({ nightNumber: 1, causes: ['shot'] }), policy)).toBe(false)
  })

  it('day-time death (exile or day-shot) → last words', () => {
    expect(lastWordsEligible(death({ time: 'day', causes: ['exile'] }), policy)).toBe(true)
    expect(lastWordsEligible(death({ time: 'day', causes: ['shot'] }), policy)).toBe(true)
  })

  it('day-only policy drops the first-night knife last words', () => {
    expect(lastWordsEligible(death({ nightNumber: 1, causes: ['wolf-kill'] }), 'day-only')).toBe(false)
    expect(lastWordsEligible(death({ time: 'day', causes: ['exile'] }), 'day-only')).toBe(true)
  })

  it('"all" grants last words to every death; "none" to no death', () => {
    const poisoned = death({ causes: ['poison'] })
    expect(lastWordsEligible(poisoned, 'all')).toBe(true)
    expect(lastWordsEligible(poisoned, 'none')).toBe(false)
    expect(lastWordsEligible(death({ time: 'day', causes: ['exile'] }), 'none')).toBe(false)
  })
})
