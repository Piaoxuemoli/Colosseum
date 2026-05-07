import { describe, expect, it } from 'vitest'
import { validate } from '@/games/werewolf/engine/validator'
import { makeBaseState } from './_helpers'

describe('validate', () => {
  it('werewolfKill: valid from werewolf to villager', () => {
    const s = { ...makeBaseState(), phase: 'night/werewolfKill' as const, currentActor: 'w1' }
    expect(validate(s, 'w1', { type: 'night/werewolfKill', targetId: 'v1', reasoning: 'x' }).ok).toBe(true)
  })

  it('werewolfKill: rejected from non-werewolf', () => {
    const s = { ...makeBaseState(), phase: 'night/werewolfKill' as const, currentActor: 's' }
    expect(validate(s, 's', { type: 'night/werewolfKill', targetId: 'v1', reasoning: 'x' }).ok).toBe(false)
  })

  it('werewolfKill: rejected outside the matching phase', () => {
    const s = { ...makeBaseState(), phase: 'day/speak' as const, currentActor: 'w1' }
    const r = validate(s, 'w1', { type: 'night/werewolfKill', targetId: 'v1', reasoning: 'x' })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('wrong-phase')
  })

  it('werewolfKill: target must be alive', () => {
    const base = makeBaseState()
    const s = {
      ...base,
      phase: 'night/werewolfKill' as const,
      currentActor: 'w1',
      players: base.players.map((p) => (p.agentId === 'v1' ? { ...p, alive: false } : p)),
    }
    const r = validate(s, 'w1', { type: 'night/werewolfKill', targetId: 'v1', reasoning: 'x' })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('target-dead')
  })

  it('seerCheck: cannot target self', () => {
    const s = { ...makeBaseState(), phase: 'night/seerCheck' as const, currentActor: 's' }
    expect(validate(s, 's', { type: 'night/seerCheck', targetId: 's' }).ok).toBe(false)
  })

  it('witchSave: forbidden first-night self-save', () => {
    const s = { ...makeBaseState(), phase: 'night/witchAction' as const, lastNightKilled: 'wi' }
    const r = validate(s, 'wi', { type: 'night/witchSave' })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('first-night-self-save')
  })

  it('witchSave: ok on day 0 for a non-self target', () => {
    const s = { ...makeBaseState(), phase: 'night/witchAction' as const, lastNightKilled: 'v1' }
    expect(validate(s, 'wi', { type: 'night/witchSave' }).ok).toBe(true)
  })

  it('witchSave: requires an actual kill on this night', () => {
    const s = { ...makeBaseState(), phase: 'night/witchAction' as const, lastNightKilled: null }
    const r = validate(s, 'wi', { type: 'night/witchSave' })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('nothing-to-save')
  })

  it('witchPoison: null target (skip) is always ok in-phase', () => {
    const s = { ...makeBaseState(), phase: 'night/witchAction' as const }
    expect(validate(s, 'wi', { type: 'night/witchPoison', targetId: null }).ok).toBe(true)
  })

  it('witchPoison: cannot target self', () => {
    const s = { ...makeBaseState(), phase: 'night/witchAction' as const }
    expect(validate(s, 'wi', { type: 'night/witchPoison', targetId: 'wi' }).ok).toBe(false)
  })

  it('day/speak: must be current actor and <=200 chars', () => {
    const s = { ...makeBaseState(), phase: 'day/speak' as const, currentActor: 'v1' }
    expect(validate(s, 'v1', { type: 'day/speak', content: 'ok' }).ok).toBe(true)
    expect(validate(s, 'v2', { type: 'day/speak', content: 'ok' }).ok).toBe(false)
    expect(validate(s, 'v1', { type: 'day/speak', content: 'x'.repeat(201) }).ok).toBe(false)
  })

  it('day/vote: null target (abstain) is ok', () => {
    const s = { ...makeBaseState(), phase: 'day/vote' as const, currentActor: 'v1' }
    expect(validate(s, 'v1', { type: 'day/vote', targetId: null }).ok).toBe(true)
  })

  it('dead actor: always rejected', () => {
    const base = makeBaseState()
    const s = {
      ...base,
      phase: 'day/vote' as const,
      currentActor: 'v1',
      players: base.players.map((p) => (p.agentId === 'v1' ? { ...p, alive: false } : p)),
    }
    const r = validate(s, 'v1', { type: 'day/vote', targetId: 'v2' })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('actor-dead')
  })
})
