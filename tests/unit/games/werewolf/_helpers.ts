import { werewolfEngine } from '@/games/werewolf/engine/werewolf-engine'
import type {
  WerewolfAction,
  WerewolfDeathCause,
  WerewolfPlayerState,
  WerewolfState,
} from '@/games/werewolf/engine/types'

/**
 * Fixed 6-player fixture: w1/w2 = werewolf, s = seer, wi = witch,
 * v1/v2 = villager. All alive, both potions present, day 0.
 * Override fields per test: `{ ...makeBaseState(), phase: 'day/vote', currentActor: 'v1' }`.
 */
export function makeBaseState(): WerewolfState {
  return {
    day: 0,
    phase: 'night/werewolfDiscussion',
    players: [
      { agentId: 'w1', name: 'W1', alive: true, seatOrder: 0, deathDay: null, deathCause: null },
      { agentId: 'w2', name: 'W2', alive: true, seatOrder: 1, deathDay: null, deathCause: null },
      { agentId: 's', name: 'S', alive: true, seatOrder: 2, deathDay: null, deathCause: null },
      { agentId: 'wi', name: 'Wi', alive: true, seatOrder: 3, deathDay: null, deathCause: null },
      { agentId: 'v1', name: 'V1', alive: true, seatOrder: 4, deathDay: null, deathCause: null },
      { agentId: 'v2', name: 'V2', alive: true, seatOrder: 5, deathDay: null, deathCause: null },
    ],
    roleAssignments: {
      w1: 'werewolf',
      w2: 'werewolf',
      s: 'seer',
      wi: 'witch',
      v1: 'villager',
      v2: 'villager',
    },
    moderatorAgentId: 'mod',
    speechQueue: [],
    // 与 createInitialState 约定一致：currentActor=首狼，队列只含其余狼
    werewolfDiscussionQueue: ['w2'],
    currentActor: 'w1',
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
}

/** Mark players dead without going through the engine (direct state construction). */
export function killPlayers(
  state: WerewolfState,
  ids: string[],
  day = 1,
  cause: WerewolfDeathCause = 'vote',
): WerewolfState {
  const dead = new Set(ids)
  return {
    ...state,
    players: state.players.map((p) =>
      dead.has(p.agentId) ? { ...p, alive: false, deathDay: day, deathCause: cause } : p,
    ),
  }
}

export function playerOf(state: WerewolfState, id: string): WerewolfPlayerState {
  const p = state.players.find((pp) => pp.agentId === id)
  if (!p) throw new Error(`fixture bug: no player ${id}`)
  return p
}

/** Convenience: run one engine action and return the next state (throws on illegal). */
export function step(state: WerewolfState, actorId: string, action: WerewolfAction): WerewolfState {
  return werewolfEngine.applyAction(state, actorId, action).nextState
}
