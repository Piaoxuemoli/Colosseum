import type { WerewolfFaction, WerewolfState } from './types'
import { factionOf } from './roles'

export interface WinResult {
  settled: boolean
  winner: WerewolfFaction | 'tie' | null
}

/**
 * Cap the number of days before forcing a tie. The spec picks 40 so that
 * agent stalls (e.g. infinite abstain loops) cannot block a match forever.
 */
export const MAX_DAYS_BEFORE_TIE = 40

export function checkWin(state: WerewolfState): WinResult {
  const alive = state.players.filter((p) => p.alive)
  const aliveWerewolves = alive.filter((p) => state.roleAssignments[p.agentId] === 'werewolf').length
  const aliveVillagers = alive.length - aliveWerewolves

  if (aliveWerewolves === 0) return { settled: true, winner: 'villagers' }
  if (aliveVillagers === 0 || aliveWerewolves >= aliveVillagers) {
    return { settled: true, winner: 'werewolves' }
  }
  if (state.day >= MAX_DAYS_BEFORE_TIE) return { settled: true, winner: 'tie' }
  return { settled: false, winner: null }
}

export { factionOf }
