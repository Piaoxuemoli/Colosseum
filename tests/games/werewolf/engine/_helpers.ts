import type { WerewolfState } from '@/games/werewolf/engine/types'

/**
 * Test fixture for a fresh 6-player game. Roles: w1/w2 = werewolf,
 * s = seer, wi = witch, v1/v2 = villager. All alive, both potions present.
 * Use `{ ...makeBaseState(), phase: '...', currentActor: '...' }` to override.
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
    werewolfDiscussionQueue: ['w1', 'w2'],
    currentActor: null,
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
