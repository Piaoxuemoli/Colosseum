/**
 * Regression guard for Phase 3-4 review finding #1: the werewolf result
 * panel only opens when a `werewolf/game-end` event arrives through SSE.
 * The GM was previously only publishing a generic `match-end` frame, so the
 * roles would never be revealed on the client.
 *
 * This test verifies the engine's terminal-state shape is what the GM now
 * reads (winner + roleAssignments). It does NOT drive the full GM tick loop
 * — that's covered by the e2e smoke test; here we only lock the contract.
 */

import { describe, expect, it } from 'vitest'
import { werewolfEngine } from '@/games/werewolf/engine/werewolf-engine'
import type { WerewolfState } from '@/games/werewolf/engine/types'
import { makeBaseState } from '../games/werewolf/engine/_helpers'

describe('werewolf terminal state exposes winner + roleAssignments for game-end event', () => {
  it('villager win after voting out the final wolf', () => {
    const base = makeBaseState()
    const s: WerewolfState = {
      ...base,
      phase: 'day/vote',
      day: 1,
      // w2 already out; voting out w1 ends the game.
      players: base.players.map((p) =>
        p.agentId === 'w2' ? { ...p, alive: false, deathDay: 1, deathCause: 'vote' } : p,
      ),
      // Four of the five alive players have already voted. The last vote
      // (v2) completes the round and triggers advancePhase → villagers win.
      voteLog: [
        { day: 1, voter: 's', target: 'w1', at: 0 },
        { day: 1, voter: 'wi', target: 'w1', at: 0 },
        { day: 1, voter: 'v1', target: 'w1', at: 0 },
        { day: 1, voter: 'w1', target: 'v2', at: 0 },
      ],
      currentActor: 'v2',
    }
    const { nextState } = werewolfEngine.applyAction(s, 'v2', {
      type: 'day/vote',
      targetId: 'w1',
    })
    const ws = nextState as WerewolfState

    // The GM reads this shape when building the werewolf/game-end payload.
    expect(ws.matchComplete).toBe(true)
    expect(ws.winner).toBe('villagers')
    expect(ws.roleAssignments).toBeTruthy()
    expect(Object.keys(ws.roleAssignments).length).toBe(6)
    expect(ws.roleAssignments['w1']).toBe('werewolf')

    // And engine.boundary marks this as match-end so the GM fires the branch.
    expect(werewolfEngine.boundary(s, ws)).toBe('match-end')
  })
})
