// Werewolf engine v2 — action legality matrix (WFR-301 / WFR-302).
//
// Pure predicate over (state, action). Every rejection is structured:
// one of six machine-readable categories + human message + timing context.
// Illegal actions never mutate state (side-effect-free by construction —
// validation runs before any clone in the engine).

import type {
  ActionRejection,
  PhaseId,
  RejectionCode,
  WerewolfAction,
  WerewolfEngineState,
} from './types'
import { playerById } from './roles'

export type Validation = { ok: true } | { ok: false; rejection: ActionRejection }

function reject(
  state: WerewolfEngineState,
  action: WerewolfAction,
  code: RejectionCode,
  message: string,
): Validation {
  return {
    ok: false,
    rejection: {
      code,
      message,
      context: {
        day: state.day,
        phase: state.phase,
        actorId: action.actorId,
        actionType: action.type,
      },
    },
  }
}

function targetAlive(state: WerewolfEngineState, targetId: string): string | null {
  const target = playerById(state, targetId)
  if (!target) return 'target-not-in-game'
  if (!target.alive) return 'target-dead'
  return null
}

export function validateAction(state: WerewolfEngineState, action: WerewolfAction): Validation {
  const actor = playerById(state, action.actorId)

  switch (action.type) {
    // ------------------------------------------------------------------ wolves
    case 'kill': {
      if (state.phase !== 'night.wolves') {
        return reject(state, action, 'WRONG_PHASE', `kill is only legal in night.wolves (current: ${state.phase})`)
      }
      if (!actor) return reject(state, action, 'WRONG_ACTOR', 'actor not in game')
      if (actor.role !== 'werewolf') return reject(state, action, 'WRONG_ACTOR', 'only werewolves may submit a kill vote')
      if (!actor.alive) return reject(state, action, 'WRONG_ACTOR', 'dead wolves cannot vote the kill')
      if (state.night?.wolfVotes.some((v) => v.voterId === action.actorId)) {
        return reject(state, action, 'EXHAUSTED', 'kill vote already cast tonight')
      }
      if (action.targetId === null) {
        if (!state.board.emptyKillAllowed) {
          return reject(state, action, 'PARAM_CONFLICT', 'empty kill (空刀) is disabled on this board (param 11)')
        }
        return { ok: true }
      }
      if (action.targetId === action.actorId && !state.board.selfKillAllowed) {
        return reject(state, action, 'PARAM_CONFLICT', 'self kill (自刀) is disabled on this board (param 12)')
      }
      const bad = targetAlive(state, action.targetId)
      if (bad) return reject(state, action, 'ILLEGAL_TARGET', bad)
      return { ok: true }
    }

    // ------------------------------------------------------------------- seer
    case 'seerCheck':
    case 'seerPass': {
      if (state.phase !== 'night.seer') {
        return reject(state, action, 'WRONG_PHASE', `seer actions are only legal in night.seer (current: ${state.phase})`)
      }
      if (!actor) return reject(state, action, 'WRONG_ACTOR', 'actor not in game')
      if (actor.role !== 'seer') return reject(state, action, 'WRONG_ACTOR', 'only the seer may check')
      if (!actor.alive) return reject(state, action, 'WRONG_ACTOR', 'dead seers cannot check')
      if (action.type === 'seerCheck') {
        if (action.targetId === action.actorId) {
          return reject(state, action, 'ILLEGAL_TARGET', 'the seer cannot check itself (WFR-103)')
        }
        const bad = targetAlive(state, action.targetId)
        if (bad) return reject(state, action, 'ILLEGAL_TARGET', bad)
      }
      return { ok: true }
    }

    // ------------------------------------------------------------------ witch
    case 'witchSave':
    case 'witchSavePass':
    case 'witchPoison':
    case 'witchPoisonPass': {
      if (!actor) return reject(state, action, 'WRONG_ACTOR', 'actor not in game')
      if (actor.role !== 'witch') return reject(state, action, 'WRONG_ACTOR', 'only the witch may use potions')
      if (!actor.alive) return reject(state, action, 'WRONG_ACTOR', 'dead witches cannot use potions')
      const night = state.night

      // Same-night second potion: report the param-5 conflict specifically,
      // even though the poison question phase has already auto-advanced (AC-2).
      if (
        action.type === 'witchPoison' &&
        night !== null &&
        night.witchSaveTarget !== null &&
        state.board.witchOnePotionPerNight
      ) {
        return reject(state, action, 'PARAM_CONFLICT', 'witch already used the save potion tonight (witchOnePotionPerNight, param 5)')
      }

      if (action.type === 'witchSave' || action.type === 'witchSavePass') {
        if (state.phase !== 'night.witch.save') {
          return reject(state, action, 'WRONG_PHASE', `save question is only legal in night.witch.save (current: ${state.phase})`)
        }
        if (action.type === 'witchSavePass') return { ok: true }
        if (!state.witchPotions.save) {
          return reject(state, action, 'EXHAUSTED', 'save potion already used')
        }
        if (night === null || night.knifeTarget === null) {
          return reject(state, action, 'ILLEGAL_TARGET', 'no knife target tonight — nothing to save')
        }
        if (action.targetId !== night.knifeTarget) {
          return reject(state, action, 'ILLEGAL_TARGET', 'the save potion may only target tonight\'s knife target')
        }
        if (action.targetId === action.actorId) {
          const policy = state.board.witchSelfSavePolicy
          if (policy === 'never') {
            return reject(state, action, 'PARAM_CONFLICT', 'witch self-save is disabled on this board (param 4: never)')
          }
          if (policy === 'first-night-only' && night.nightNumber > 1) {
            return reject(state, action, 'PARAM_CONFLICT', `witch self-save is first-night-only (param 4); it is night ${night.nightNumber}`)
          }
        }
        return { ok: true }
      }

      // witchPoison / witchPoisonPass
      if (state.phase !== 'night.witch.poison') {
        return reject(state, action, 'WRONG_PHASE', `poison question is only legal in night.witch.poison (current: ${state.phase})`)
      }
      if (action.type === 'witchPoisonPass') return { ok: true }
      if (!state.witchPotions.poison) {
        return reject(state, action, 'EXHAUSTED', 'poison potion already used')
      }
      if (action.targetId === action.actorId) {
        return reject(state, action, 'ILLEGAL_TARGET', 'the witch cannot poison itself')
      }
      const bad = targetAlive(state, action.targetId)
      if (bad) return reject(state, action, 'ILLEGAL_TARGET', bad)
      return { ok: true }
    }

    // ------------------------------------------------------------------- day
    case 'speak': {
      if (state.phase !== 'day.speech' && state.phase !== 'day.pkSpeech') {
        return reject(state, action, 'WRONG_PHASE', `speak is only legal in day.speech/day.pkSpeech (current: ${state.phase})`)
      }
      if (!actor) return reject(state, action, 'WRONG_ACTOR', 'actor not in game')
      if (!actor.alive) return reject(state, action, 'WRONG_ACTOR', 'dead players cannot speak in day phases')
      if (state.pendingActor !== action.actorId) {
        return reject(state, action, 'WRONG_ACTOR', 'not this player\'s speech slot')
      }
      if (action.content.length > state.board.speechMaxLength) {
        return reject(state, action, 'PARAM_CONFLICT', `speech exceeds board budget (${action.content.length} > ${state.board.speechMaxLength}, WOD-4)`)
      }
      return { ok: true }
    }

    case 'vote': {
      if (state.phase !== 'day.vote' && state.phase !== 'day.pkVote') {
        return reject(state, action, 'WRONG_PHASE', `vote is only legal in day.vote/day.pkVote (current: ${state.phase})`)
      }
      if (!actor) return reject(state, action, 'WRONG_ACTOR', 'actor not in game')
      if (!actor.alive) return reject(state, action, 'WRONG_ACTOR', 'dead players cannot vote')
      const round = state.voteRound
      if (round && round.votes.some((v) => v.voterId === action.actorId)) {
        return reject(state, action, 'EXHAUSTED', 'vote already cast in this round')
      }
      if (action.targetId === null) return { ok: true } // 弃票 legal
      if (round && round.round === 'pk' && round.candidates && !round.candidates.includes(action.targetId)) {
        return reject(state, action, 'ILLEGAL_TARGET', 'PK revote may only target the tied candidates')
      }
      const bad = targetAlive(state, action.targetId)
      if (bad) return reject(state, action, 'ILLEGAL_TARGET', bad)
      return { ok: true }
    }

    case 'lastWords':
    case 'lastWordsPass': {
      if (state.phase !== 'day.lastWords') {
        return reject(state, action, 'WRONG_PHASE', `last words are only legal in day.lastWords (current: ${state.phase})`)
      }
      if (!actor) return reject(state, action, 'WRONG_ACTOR', 'actor not in game')
      if (state.pendingActor !== action.actorId) {
        return reject(state, action, 'WRONG_ACTOR', 'not this player\'s last-words slot')
      }
      if (action.type === 'lastWords' && action.content.length > state.board.lastWordsMaxLength) {
        return reject(state, action, 'PARAM_CONFLICT', `last words exceed board budget (${action.content.length} > ${state.board.lastWordsMaxLength})`)
      }
      return { ok: true }
    }

    // ---------------------------------------------------------------- hunter
    case 'hunterShoot':
    case 'hunterPass': {
      if (state.phase !== 'day.hunterWindow') {
        return reject(state, action, 'WRONG_PHASE', `hunter window actions are only legal in day.hunterWindow (current: ${state.phase})`)
      }
      if (!actor) return reject(state, action, 'WRONG_ACTOR', 'actor not in game')
      if (actor.role !== 'hunter') return reject(state, action, 'WRONG_ACTOR', 'only hunters can shoot')
      if (state.pendingActor !== action.actorId) {
        return reject(state, action, 'WRONG_ACTOR', 'not this hunter\'s shoot window')
      }
      if (state.hunterShotsUsed.includes(action.actorId)) {
        return reject(state, action, 'EXHAUSTED', 'hunter shot already used')
      }
      if (action.type === 'hunterShoot') {
        const bad = targetAlive(state, action.targetId)
        if (bad) return reject(state, action, 'ILLEGAL_TARGET', bad)
        if (action.targetId === action.actorId) {
          return reject(state, action, 'ILLEGAL_TARGET', 'cannot shoot itself')
        }
      }
      return { ok: true }
    }
  }
}

/** Phase an action type belongs to (used by rejection context helpers). */
export function phaseForActionType(type: WerewolfAction['type']): PhaseId {
  switch (type) {
    case 'kill':
      return 'night.wolves'
    case 'seerCheck':
    case 'seerPass':
      return 'night.seer'
    case 'witchSave':
    case 'witchSavePass':
      return 'night.witch.save'
    case 'witchPoison':
    case 'witchPoisonPass':
      return 'night.witch.poison'
    case 'speak':
      return 'day.speech'
    case 'vote':
      return 'day.vote'
    case 'lastWords':
    case 'lastWordsPass':
      return 'day.lastWords'
    case 'hunterShoot':
    case 'hunterPass':
      return 'day.hunterWindow'
  }
}
