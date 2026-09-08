// Werewolf engine v2 — role taxonomy + tiny state lookups.
//
// Pure helpers shared by validator / phases / settlement. No cycles: this
// module only depends on ./types.

import type {
  Camp,
  Faction,
  NightRoleId,
  PlayerSlot,
  ResolvedBoard,
  RoleId,
  WerewolfEngineState,
} from './types'

export function factionOf(role: RoleId): Faction {
  return campOf(role) === 'wolf' ? 'wolves' : 'good'
}

/** 屠边 edges: every role maps to wolf / god / villager (WFR-405). */
export function campOf(role: RoleId): Camp {
  switch (role) {
    case 'werewolf':
    case 'wolfKing':
    case 'whiteWolfKing':
      return 'wolf'
    case 'villager':
    case 'thief':
      return 'villager'
    case 'seer':
    case 'witch':
    case 'hunter':
    case 'guard':
    case 'idiot':
    case 'elder':
    case 'dreamWeaver':
    case 'cupid':
    case 'knight':
      return 'god'
  }
}

export function playerById(state: WerewolfEngineState, playerId: string): PlayerSlot | null {
  return state.players.find((p) => p.playerId === playerId) ?? null
}

export function alivePlayers(state: WerewolfEngineState): PlayerSlot[] {
  return state.players.filter((p) => p.alive)
}

export function aliveWolves(state: WerewolfEngineState): PlayerSlot[] {
  return state.players.filter((p) => p.alive && p.role === 'werewolf')
}

export function aliveByRole(state: WerewolfEngineState, role: RoleId): PlayerSlot | null {
  return state.players.find((p) => p.alive && p.role === role) ?? null
}

export function playersByRole(state: WerewolfEngineState, role: RoleId): PlayerSlot[] {
  return state.players.filter((p) => p.role === role)
}

export function bySeat(a: PlayerSlot, b: PlayerSlot): number {
  return a.seat - b.seat
}

/** Night-capable roles actually present in a board (param 1 × param 15). */
export function nightRolesInBoard(board: ResolvedBoard): NightRoleId[] {
  const present: NightRoleId[] = []
  if ((board.roles.guard ?? 0) > 0) present.push('guard')
  if ((board.roles.werewolf ?? 0) > 0) present.push('werewolf')
  if ((board.roles.witch ?? 0) > 0) present.push('witch')
  if ((board.roles.seer ?? 0) > 0) present.push('seer')
  return present
}

/** Role count helper for board validation. */
export function countByCamp(board: ResolvedBoard, camp: Camp): number {
  let total = 0
  for (const [role, count] of Object.entries(board.roles) as Array<[RoleId, number]>) {
    if (count > 0 && campOf(role) === camp) total += count
  }
  return total
}
