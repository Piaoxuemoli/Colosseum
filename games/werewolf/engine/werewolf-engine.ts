import type { GameEngine, ActionSpec, ApplyActionResult, BoundaryKind } from '@/lib/engine/contracts'
import type { GameEvent, MatchResult } from '@/lib/core/types'
import { newEventId } from '@/lib/core/ids'
import type { WerewolfAction, WerewolfEngineConfig, WerewolfRole, WerewolfState } from './types'
import { assignRoles, seededRng } from './roles'
import { advancePhase } from './phase-machine'
import { validate } from './validator'

/**
 * Werewolf engine — implements the shared GameEngine contract.
 *
 * Pure TypeScript; no IO / React / DB imports. Orchestrator + adapters wire
 * Redis, A2A and DB around this module in Phase 3-3.
 */
export const werewolfEngine: GameEngine<WerewolfState, WerewolfAction, WerewolfEngineConfig> = {
  createInitialState(config, agentIds) {
    const rng = typeof config.seed === 'number' ? seededRng(config.seed) : Math.random
    const roleAssignments = assignRoles(agentIds, rng)
    const werewolfQueue = agentIds.filter((id) => roleAssignments[id] === 'werewolf')
    return {
      day: 0,
      phase: 'night/werewolfDiscussion',
      players: agentIds.map((id, i) => ({
        agentId: id,
        name: config.agentNames?.[id] ?? id,
        alive: true,
        seatOrder: i,
        deathDay: null,
        deathCause: null,
      })),
      roleAssignments,
      moderatorAgentId: config.moderatorAgentId ?? null,
      speechQueue: [],
      werewolfDiscussionQueue: werewolfQueue.slice(1),
      currentActor: werewolfQueue[0] ?? null,
      witchPotions: { save: true, poison: true },
      lastNightKilled: null,
      lastNightSaved: null,
      lastNightPoisoned: null,
      seerCheckResults: [],
      speechLog: [],
      voteLog: [],
      matchComplete: false,
      winner: null,
    }
  },

  currentActor(state) {
    return state.currentActor
  },

  availableActions(state, agentId) {
    if (state.currentActor !== agentId) return []
    const role = state.roleAssignments[agentId]
    const list: ActionSpec<WerewolfAction>[] = []
    switch (state.phase) {
      case 'night/werewolfDiscussion':
        if (role === 'werewolf') {
          list.push({ type: 'day/speak', label: '狼人讨论' })
        }
        break
      case 'night/werewolfKill':
        if (role === 'werewolf') {
          list.push({ type: 'night/werewolfKill' })
        }
        break
      case 'night/seerCheck':
        if (role === 'seer') list.push({ type: 'night/seerCheck' })
        break
      case 'night/witchAction':
        if (role === 'witch') {
          if (state.witchPotions.save) list.push({ type: 'night/witchSave' })
          list.push({ type: 'night/witchPoison' })
        }
        break
      case 'day/speak':
        list.push({ type: 'day/speak' })
        break
      case 'day/vote':
        list.push({ type: 'day/vote' })
        break
      default:
        break
    }
    return list
  },

  applyAction(state, actorId, action): ApplyActionResult<WerewolfState> {
    const legality = validate(state, actorId, action)
    if (!legality.ok) {
      throw new Error(`werewolfEngine.applyAction: invalid action (${legality.reason})`)
    }

    let next: WerewolfState = structuredClone(state)
    const now = Date.now()
    const gameEvents: Array<Omit<GameEvent, 'matchId' | 'seq' | 'id'>> = []

    switch (action.type) {
      case 'night/werewolfKill':
        next.lastNightKilled = action.targetId
        gameEvents.push(baseEvent('werewolf/werewolfKill', actorId, { targetId: action.targetId, reasoning: action.reasoning }, 'role-restricted', werewolfIds(next)))
        next = advancePhase(next)
        break

      case 'night/seerCheck':
        next.seerCheckResults.push({
          day: next.day,
          targetId: action.targetId,
          role: next.roleAssignments[action.targetId] as WerewolfRole,
        })
        gameEvents.push(baseEvent(
          'werewolf/seerCheck',
          actorId,
          { targetId: action.targetId, role: next.roleAssignments[action.targetId] },
          'role-restricted',
          [actorId],
        ))
        next = advancePhase(next)
        break

      case 'night/witchSave':
        next.witchPotions.save = false
        next.lastNightSaved = next.lastNightKilled
        gameEvents.push(baseEvent('werewolf/witchSave', actorId, { savedId: next.lastNightKilled }, 'role-restricted', [actorId]))
        next = advancePhase(next)
        break

      case 'night/witchPoison':
        if (action.targetId !== null) {
          next.witchPotions.poison = false
          next.lastNightPoisoned = action.targetId
        }
        gameEvents.push(baseEvent('werewolf/witchPoison', actorId, { targetId: action.targetId }, 'role-restricted', [actorId]))
        next = advancePhase(next)
        break

      case 'day/speak':
        next.speechLog.push({
          day: next.day,
          agentId: actorId,
          content: action.content,
          claimedRole: action.claimedRole,
          at: now,
        })
        gameEvents.push(baseEvent('werewolf/speak', actorId, { day: next.day, content: action.content, claimedRole: action.claimedRole ?? null }, 'public'))
        // speech phase only advances when the queue drains; delegate to phase-machine
        if (next.speechQueue.length === 0) {
          next = advancePhase(next)
        } else {
          next.currentActor = next.speechQueue.shift() ?? null
        }
        break

      case 'day/vote': {
        next.voteLog.push({
          day: next.day,
          voter: actorId,
          target: action.targetId,
          reason: action.reason,
          at: now,
        })
        gameEvents.push(baseEvent('werewolf/vote', actorId, { day: next.day, target: action.targetId, reason: action.reason ?? null }, 'public'))
        const voted = new Set(next.voteLog.filter((v) => v.day === next.day).map((v) => v.voter))
        const pending = next.players.find((p) => p.alive && !voted.has(p.agentId))
        if (!pending) {
          next = advancePhase(next)
        } else {
          next.currentActor = pending.agentId
        }
        break
      }
    }

    const events: GameEvent[] = gameEvents.map((e) => ({
      ...e,
      id: newEventId(),
      matchId: '',
      seq: 0,
    }))
    return { nextState: next, events }
  },

  boundary(prevState, nextState): BoundaryKind | null {
    if (!prevState.matchComplete && nextState.matchComplete) return 'match-end'
    if (prevState.day !== nextState.day) return 'round-end'
    return null
  },

  finalize(state): MatchResult {
    const alive = state.players.filter((p) => p.alive)
    const winner = state.winner ?? null
    const ranking = [...state.players]
      .sort((a, b) => (a.alive === b.alive ? a.seatOrder - b.seatOrder : a.alive ? -1 : 1))
      .map((p, i) => ({
        agentId: p.agentId,
        rank: i + 1,
        score: p.alive ? 1 : 0,
        extra: {
          role: state.roleAssignments[p.agentId],
          deathDay: p.deathDay,
          deathCause: p.deathCause,
        },
      }))
    return {
      winnerFaction: winner,
      ranking,
      stats: { aliveCount: alive.length, totalDays: state.day },
    }
  },
}

function baseEvent(
  kind: string,
  actorAgentId: string | null,
  payload: Record<string, unknown>,
  visibility: 'public' | 'role-restricted' | 'private',
  restrictedTo: string[] | null = null,
): Omit<GameEvent, 'id' | 'matchId' | 'seq'> {
  return {
    gameType: 'werewolf',
    occurredAt: new Date().toISOString(),
    kind,
    actorAgentId,
    payload,
    visibility,
    restrictedTo,
  }
}

function werewolfIds(state: WerewolfState): string[] {
  return state.players
    .filter((p) => state.roleAssignments[p.agentId] === 'werewolf')
    .map((p) => p.agentId)
}
