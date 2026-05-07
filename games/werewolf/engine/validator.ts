import type { WerewolfAction, WerewolfState } from './types'

export interface ValidationResult {
  ok: boolean
  reason?: string
}

/**
 * Phase-aware action legality check. Pure function, no IO.
 *
 * Returns `ok: true` when the action is legal for the actor in the current
 * state. Rejection reasons use short lowercase codes suitable for logging.
 */
export function validate(
  state: WerewolfState,
  actorId: string,
  action: WerewolfAction,
): ValidationResult {
  const actor = state.players.find((p) => p.agentId === actorId)
  if (!actor) return { ok: false, reason: 'actor-not-in-game' }
  if (!actor.alive) return { ok: false, reason: 'actor-dead' }
  const role = state.roleAssignments[actorId]

  switch (action.type) {
    case 'night/werewolfKill':
      if (state.phase !== 'night/werewolfKill') return { ok: false, reason: 'wrong-phase' }
      if (role !== 'werewolf') return { ok: false, reason: 'not-werewolf' }
      if (state.currentActor !== actorId) return { ok: false, reason: 'not-your-turn' }
      return targetAlive(state, action.targetId)

    case 'night/seerCheck':
      if (state.phase !== 'night/seerCheck') return { ok: false, reason: 'wrong-phase' }
      if (role !== 'seer') return { ok: false, reason: 'not-seer' }
      if (action.targetId === actorId) return { ok: false, reason: 'cannot-check-self' }
      return targetAlive(state, action.targetId)

    case 'night/witchSave':
      if (state.phase !== 'night/witchAction') return { ok: false, reason: 'wrong-phase' }
      if (role !== 'witch') return { ok: false, reason: 'not-witch' }
      if (!state.witchPotions.save) return { ok: false, reason: 'no-save-potion' }
      if (state.lastNightKilled === null) return { ok: false, reason: 'nothing-to-save' }
      if (state.day === 0 && state.lastNightKilled === actorId) {
        return { ok: false, reason: 'first-night-self-save' }
      }
      return { ok: true }

    case 'night/witchPoison':
      if (state.phase !== 'night/witchAction') return { ok: false, reason: 'wrong-phase' }
      if (role !== 'witch') return { ok: false, reason: 'not-witch' }
      if (action.targetId === null) return { ok: true } // skip is always allowed
      if (!state.witchPotions.poison) return { ok: false, reason: 'no-poison-potion' }
      if (action.targetId === actorId) return { ok: false, reason: 'cannot-poison-self' }
      return targetAlive(state, action.targetId)

    case 'day/speak':
      // Wolves also use `day/speak` during `night/werewolfDiscussion` to coordinate.
      if (state.phase !== 'day/speak' && state.phase !== 'night/werewolfDiscussion') {
        return { ok: false, reason: 'wrong-phase' }
      }
      if (state.phase === 'night/werewolfDiscussion' && role !== 'werewolf') {
        return { ok: false, reason: 'not-werewolf' }
      }
      if (state.currentActor !== actorId) return { ok: false, reason: 'not-your-turn' }
      if (action.content.length > 200) return { ok: false, reason: 'speech-too-long' }
      return { ok: true }

    case 'day/vote':
      if (state.phase !== 'day/vote') return { ok: false, reason: 'wrong-phase' }
      if (state.currentActor !== actorId) return { ok: false, reason: 'not-your-turn' }
      if (action.targetId === null) return { ok: true }
      return targetAlive(state, action.targetId)

    default: {
      const exhaustive: never = action
      return { ok: false, reason: `unknown-action:${JSON.stringify(exhaustive)}` }
    }
  }
}

function targetAlive(state: WerewolfState, id: string): ValidationResult {
  const t = state.players.find((p) => p.agentId === id)
  if (!t) return { ok: false, reason: 'target-not-in-game' }
  if (!t.alive) return { ok: false, reason: 'target-dead' }
  return { ok: true }
}
