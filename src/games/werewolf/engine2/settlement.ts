// Werewolf engine v2 — night resolution, terminal evaluation and the
// hunter / last-words ruling tables (WFR-401/402/405, WFR-103, WFR-105).
//
// Pure functions only; the night resolver implements the FULL conflict table
// including the guard rows (奶穿/毒穿) so v1-M2 boards light up without core
// changes (NFR-W4). Guard scenarios are unit-tested directly against these
// functions even though M1 boards cannot seat a guard yet.

import type {
  DeathCause,
  DeathRecord,
  LastWordsPolicy,
  PlayerSlot,
  RoleId,
  WinCondition,
} from './types'
import { campOf } from './roles'

// ---------------------------------------------------------------------------
// Night settlement (WFR-402)
// ---------------------------------------------------------------------------

export interface NightActionSet {
  knifeTarget: string | null
  guardTarget: string | null
  witchSaveTarget: string | null
  witchPoisonTarget: string | null
}

export interface NightResolution {
  /** Deaths in settlement order (knife first, then poison); causes may stack. */
  deaths: Array<{ playerId: string; causes: DeathCause[] }>
  /** Settlement facts/conflicts for the moderator event #8 (奶穿/毒穿/被救…). */
  facts: string[]
}

/**
 * Collect-then-settle (WFR-401): one pass over the night's actions applying
 * the WFR-402 ruling table:
 *   狼刀+守护 → 不死；狼刀+解药 → 不死；同守同救 → param 19 (奶穿=死)；
 *   毒药+守护 → param 20 (毒穿=死)；狼刀与毒同目标 → 只死一次；空刀 → 无人死。
 */
export function resolveNight(
  actions: NightActionSet,
  params: { guardSaveConflict: 'milk-pierce' | 'both-save'; guardBlocksPoison: boolean },
): NightResolution {
  const deaths: NightResolution['deaths'] = []
  const facts: string[] = []

  const knife = actions.knifeTarget
  if (knife !== null) {
    const guarded = actions.guardTarget === knife
    const saved = actions.witchSaveTarget === knife
    if (guarded && saved) {
      if (params.guardSaveConflict === 'milk-pierce') {
        deaths.push({ playerId: knife, causes: ['wolf-kill', 'milk-pierce'] })
        facts.push('milk-pierce:same-guard-and-save')
      } else {
        facts.push('both-save:guarded-and-saved')
      }
    } else if (guarded) {
      facts.push('guarded')
    } else if (saved) {
      facts.push('saved')
    } else {
      deaths.push({ playerId: knife, causes: ['wolf-kill'] })
    }
  }

  const poison = actions.witchPoisonTarget
  if (poison !== null) {
    const blocked = params.guardBlocksPoison && actions.guardTarget === poison
    if (blocked) {
      facts.push('poison-blocked-by-guard')
    } else {
      const existing = deaths.find((d) => d.playerId === poison)
      if (existing) {
        existing.causes.push('poison')
        facts.push('knife-and-poison-same-target')
      } else {
        deaths.push({ playerId: poison, causes: ['poison'] })
      }
    }
  }

  return { deaths, facts }
}

// ---------------------------------------------------------------------------
// Terminal evaluation (WFR-405 / WFR-406)
// ---------------------------------------------------------------------------

export type WinEvaluation =
  | { settled: false }
  | { settled: true; winner: 'wolves' | 'good' | 'tie'; basis: string }

/**
 * 屠边: wolves win when all gods OR all villagers are gone;
 * 屠城: wolves win when all good players are gone;
 * 屠城+parity: adds wolves ≥ good as a fast path.
 * Good wins when the last wolf is gone. 狼刀在先 (param 3) decides ordering
 * when both sides' conditions land in the same settlement — including the
 * everyone-dead corner, which always settles (WFR-406-2 全死兜底).
 */
export function evaluateWin(
  alive: ReadonlyArray<{ playerId: string; role: RoleId }>,
  params: { winCondition: WinCondition; wolfPriority: boolean },
): WinEvaluation {
  let wolves = 0
  let gods = 0
  let villagers = 0
  for (const p of alive) {
    const camp = campOf(p.role)
    if (camp === 'wolf') wolves += 1
    else if (camp === 'god') gods += 1
    else villagers += 1
  }
  const good = gods + villagers

  const wolfWin = (): WinEvaluation | null => {
    switch (params.winCondition) {
      case 'kill-side':
        if (gods === 0) return { settled: true, winner: 'wolves', basis: 'kill-side:gods-eliminated' }
        if (villagers === 0) return { settled: true, winner: 'wolves', basis: 'kill-side:villagers-eliminated' }
        return null
      case 'kill-all':
        return good === 0 ? { settled: true, winner: 'wolves', basis: 'kill-all:no-good-alive' } : null
      case 'kill-all-parity':
        if (good === 0) return { settled: true, winner: 'wolves', basis: 'kill-all:no-good-alive' }
        return wolves >= good
          ? { settled: true, winner: 'wolves', basis: 'kill-all-parity:wolves-no-fewer-than-good' }
          : null
    }
  }
  const goodWin: WinEvaluation | null =
    wolves === 0 ? { settled: true, winner: 'good', basis: 'all-wolves-eliminated' } : null

  if (params.wolfPriority) {
    const w = wolfWin()
    if (w) return w
    if (goodWin) return goodWin
  } else {
    if (goodWin) return goodWin
    const w = wolfWin()
    if (w) return w
  }
  return { settled: false }
}

// ---------------------------------------------------------------------------
// Hunter rulings (WFR-103 hunter / params 16-17)
// ---------------------------------------------------------------------------

/**
 * Can a hunter whose death carried `causes` still fire?
 * Poisoned → banned unless param 16 allows; milk-pierced → banned only if
 * param 17 forbids (default allows: 奶穿视同被刀). Knife / exile / shot → allowed.
 */
export function hunterCanShoot(
  causes: readonly DeathCause[],
  params: { hunterShootOnPoison: boolean; hunterShootOnMilkPierce: boolean },
): boolean {
  if (causes.includes('poison') && !params.hunterShootOnPoison) return false
  if (causes.includes('milk-pierce') && !params.hunterShootOnMilkPierce) return false
  return true
}

// ---------------------------------------------------------------------------
// Last-words matrix (WFR-105 / param 8)
// ---------------------------------------------------------------------------

/**
 * 首夜+白天: day deaths yes; night deaths only knife-class (wolf-kill /
 * milk-pierce) on night #1 — poisoned and night-time-shot never speak.
 * day-only: day deaths only. all: everything. none: nothing.
 */
export function lastWordsEligible(death: DeathRecord, policy: LastWordsPolicy): boolean {
  if (policy === 'none') return false
  if (policy === 'all') return true
  if (death.time === 'day') return true // both first-night-and-day and day-only
  if (policy === 'day-only') return false
  // first-night-and-day, night death:
  return (
    death.nightNumber === 1 &&
    death.causes.some((c) => c === 'wolf-kill' || c === 'milk-pierce')
  )
}

/** Convenience: alive snapshot shape used by evaluateWin callers. */
export function aliveForWin(players: readonly PlayerSlot[]): Array<{ playerId: string; role: RoleId }> {
  return players.filter((p) => p.alive).map((p) => ({ playerId: p.playerId, role: p.role }))
}
