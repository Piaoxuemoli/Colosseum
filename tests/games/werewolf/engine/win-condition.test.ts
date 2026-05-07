import { describe, expect, it } from 'vitest'
import { checkWin, MAX_DAYS_BEFORE_TIE } from '@/games/werewolf/engine/win-condition'
import { makeBaseState } from './_helpers'

function withAlive(alive: Record<string, boolean>) {
  const base = makeBaseState()
  return {
    ...base,
    day: 1,
    players: base.players.map((p) => ({
      ...p,
      alive: alive[p.agentId] ?? p.alive,
      deathDay: alive[p.agentId] === false ? 1 : null,
      deathCause: alive[p.agentId] === false ? ('vote' as const) : null,
    })),
  }
}

describe('checkWin', () => {
  it('villagers win when all werewolves are dead', () => {
    const s = withAlive({ w1: false, w2: false, s: true, wi: true, v1: true, v2: true })
    expect(checkWin(s)).toEqual({ settled: true, winner: 'villagers' })
  })

  it('werewolves win when werewolves >= villagers', () => {
    const s = withAlive({ w1: true, w2: true, s: false, wi: false, v1: true, v2: false })
    expect(checkWin(s).winner).toBe('werewolves')
  })

  it('werewolves win when all villagers are dead', () => {
    const s = withAlive({ w1: true, w2: true, s: false, wi: false, v1: false, v2: false })
    expect(checkWin(s).winner).toBe('werewolves')
  })

  it('ongoing when 2 wolves vs >=3 villagers', () => {
    const s = withAlive({ w1: true, w2: true, s: true, wi: true, v1: true, v2: false })
    expect(checkWin(s).settled).toBe(false)
  })

  it('tie triggered at MAX_DAYS_BEFORE_TIE', () => {
    const s = { ...withAlive({}), day: MAX_DAYS_BEFORE_TIE }
    expect(checkWin(s).winner).toBe('tie')
  })
})
