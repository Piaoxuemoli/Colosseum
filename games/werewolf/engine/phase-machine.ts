import type { WerewolfPhase, WerewolfState } from './types'
import { checkWin } from './win-condition'

/**
 * Pure function: given a state whose intra-phase actions are exhausted,
 * return a new state whose phase has advanced one step forward, with any
 * derived state (currentActor, queues, deaths) recomputed.
 *
 * Callers are expected to resolve intra-phase queues themselves (e.g. cycle
 * through `werewolfDiscussionQueue` / `speechQueue` entries). This function
 * is responsible only for the cross-phase transition.
 */
export function advancePhase(state: WerewolfState): WerewolfState {
  const s: WerewolfState = structuredClone(state)

  switch (s.phase) {
    case 'night/werewolfDiscussion':
      s.phase = 'night/werewolfKill'
      s.currentActor = firstAliveWerewolf(s)
      return markWinIfSettled(s)

    case 'night/werewolfKill':
      s.phase = 'night/seerCheck'
      s.currentActor = aliveByRole(s, 'seer')
      return markWinIfSettled(s)

    case 'night/seerCheck':
      s.phase = 'night/witchAction'
      s.currentActor = aliveByRole(s, 'witch')
      return markWinIfSettled(s)

    case 'night/witchAction':
      resolveNightDeaths(s)
      s.phase = 'day/announce'
      s.day += 1
      s.currentActor = null
      return markWinIfSettled(s)

    case 'day/announce':
      s.phase = 'day/speak'
      s.speechQueue = s.players.filter((p) => p.alive).map((p) => p.agentId)
      s.currentActor = s.speechQueue.shift() ?? null
      return markWinIfSettled(s)

    case 'day/speak':
      if (s.speechQueue.length > 0) {
        s.currentActor = s.speechQueue.shift() ?? null
        return s
      }
      s.phase = 'day/vote'
      s.currentActor = firstAlive(s)
      return markWinIfSettled(s)

    case 'day/vote':
      s.phase = 'day/execute'
      s.currentActor = null
      return markWinIfSettled(s)

    case 'day/execute':
      resolveVoteExecution(s)
      s.phase = 'night/werewolfDiscussion'
      s.werewolfDiscussionQueue = s.players
        .filter((p) => p.alive && s.roleAssignments[p.agentId] === 'werewolf')
        .map((p) => p.agentId)
      s.currentActor = s.werewolfDiscussionQueue.shift() ?? null
      return markWinIfSettled(s)

    default: {
      const exhaustive: never = s.phase
      throw new Error(`unknown phase: ${exhaustive as string}`)
    }
  }
}

function markWinIfSettled(s: WerewolfState): WerewolfState {
  const w = checkWin(s)
  if (w.settled) {
    s.matchComplete = true
    s.winner = w.winner
    s.currentActor = null
  }
  return s
}

function resolveNightDeaths(s: WerewolfState): void {
  let killed: string | null = s.lastNightKilled
  if (killed !== null && s.lastNightSaved === killed) killed = null

  const dead = new Set<string>()
  if (killed) dead.add(killed)
  if (s.lastNightPoisoned) dead.add(s.lastNightPoisoned)

  for (const id of dead) {
    const p = s.players.find((pp) => pp.agentId === id)
    if (!p) continue
    p.alive = false
    p.deathDay = s.day
    p.deathCause = id === killed ? 'werewolfKill' : 'witchPoison'
  }

  s.lastNightKilled = null
  s.lastNightSaved = null
  s.lastNightPoisoned = null
}

function resolveVoteExecution(s: WerewolfState): void {
  const tally = new Map<string, number>()
  for (const v of s.voteLog) {
    if (v.day !== s.day || v.target === null) continue
    tally.set(v.target, (tally.get(v.target) ?? 0) + 1)
  }
  let top: string | null = null
  let topN = 0
  let tied = false
  for (const [k, n] of tally) {
    if (n > topN) {
      top = k
      topN = n
      tied = false
    } else if (n === topN) {
      tied = true
    }
  }
  if (top && !tied) {
    const p = s.players.find((pp) => pp.agentId === top)
    if (p) {
      p.alive = false
      p.deathDay = s.day
      p.deathCause = 'vote'
    }
  }
}

function firstAlive(s: WerewolfState): string | null {
  return s.players.find((p) => p.alive)?.agentId ?? null
}

function firstAliveWerewolf(s: WerewolfState): string | null {
  return (
    s.players.find((p) => p.alive && s.roleAssignments[p.agentId] === 'werewolf')?.agentId ?? null
  )
}

function aliveByRole(s: WerewolfState, role: string): string | null {
  const p = s.players.find((pp) => pp.alive && s.roleAssignments[pp.agentId] === role)
  return p?.agentId ?? null
}

/** Exposed for engine unit tests; not used directly by the engine. */
export type { WerewolfPhase }
