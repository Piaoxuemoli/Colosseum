import type { WerewolfRole, WerewolfFaction } from './types'

/**
 * Simplified 6-player composition:
 *   2 werewolves · 1 seer · 1 witch · 2 villagers.
 */
export const WEREWOLF_ROLE_COMPOSITION: Record<WerewolfRole, number> = {
  werewolf: 2,
  seer: 1,
  witch: 1,
  villager: 2,
}

export function factionOf(role: WerewolfRole): WerewolfFaction {
  return role === 'werewolf' ? 'werewolves' : 'villagers'
}

/** Fisher–Yates shuffle with an injectable rng for determinism. */
function shuffle<T>(arr: T[], rng: () => number): T[] {
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** Seeded linear congruential RNG for reproducible tests. */
export function seededRng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

export function assignRoles(
  agentIds: string[],
  rng: () => number = Math.random,
): Record<string, WerewolfRole> {
  if (agentIds.length !== 6) {
    throw new Error('werewolf requires exactly 6 agents')
  }
  const pool: WerewolfRole[] = []
  for (const [role, count] of Object.entries(WEREWOLF_ROLE_COMPOSITION) as Array<[WerewolfRole, number]>) {
    for (let i = 0; i < count; i++) pool.push(role)
  }
  const shuffled = shuffle(pool, rng)
  const out: Record<string, WerewolfRole> = {}
  agentIds.forEach((id, i) => {
    out[id] = shuffled[i]
  })
  return out
}
