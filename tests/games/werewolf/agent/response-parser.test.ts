import { describe, expect, it } from 'vitest'
import { WerewolfResponseParser } from '@/games/werewolf/agent/response-parser'
import type { BeliefEntry } from '@/games/werewolf/memory/types'

type ParsedWithBelief = ReturnType<WerewolfResponseParser['parse']> & {
  beliefUpdate?: Record<string, Partial<BeliefEntry>>
}

describe('WerewolfResponseParser', () => {
  const parser = new WerewolfResponseParser()

  it('parses thinking + belief + action', () => {
    const raw = `<thinking>observation</thinking>
<belief>{"v1":{"werewolf":0.7,"villager":0.2,"seer":0,"witch":0.1}}</belief>
<action>{"type":"day/vote","targetId":"v1"}</action>`
    const r = parser.parse(raw, []) as ParsedWithBelief
    expect(r.thinking).toBe('observation')
    expect(r.action).toEqual({ type: 'day/vote', targetId: 'v1', reason: undefined })
    expect(r.beliefUpdate?.v1?.werewolf).toBe(0.7)
    expect(r.fallbackUsed).toBe(false)
  })

  it('still works with no belief block', () => {
    const raw = `<thinking>hi</thinking>
<action>{"type":"day/speak","content":"i am seer"}</action>`
    const r = parser.parse(raw, []) as ParsedWithBelief
    expect(r.fallbackUsed).toBe(false)
    expect(r.action).toEqual({ type: 'day/speak', content: 'i am seer', claimedRole: undefined })
    expect(r.beliefUpdate).toBeUndefined()
  })

  it('falls back on missing action block', () => {
    const raw = `<thinking>hi</thinking>`
    const r = parser.parse(raw, []) as ParsedWithBelief
    expect(r.fallbackUsed).toBe(true)
    expect((r.action as { type: string }).type).toBe('day/speak')
  })

  it('falls back on malformed action JSON', () => {
    const raw = `<action>{not-json</action>`
    const r = parser.parse(raw, []) as ParsedWithBelief
    expect(r.fallbackUsed).toBe(true)
  })

  it('tolerates malformed belief JSON (ignores it, keeps action)', () => {
    const raw = `<belief>{not json</belief>
<action>{"type":"day/vote","targetId":null}</action>`
    const r = parser.parse(raw, []) as ParsedWithBelief
    expect(r.fallbackUsed).toBe(false)
    expect(r.beliefUpdate).toBeUndefined()
    expect(r.action).toEqual({ type: 'day/vote', targetId: null, reason: undefined })
  })

  it('normalizes werewolfKill action with default reasoning', () => {
    const raw = `<action>{"type":"night/werewolfKill","targetId":"v2"}</action>`
    const r = parser.parse(raw, []) as ParsedWithBelief
    expect(r.action).toEqual({ type: 'night/werewolfKill', targetId: 'v2', reasoning: '' })
  })

  it('supports witchSave with no target', () => {
    const raw = `<action>{"type":"night/witchSave"}</action>`
    const r = parser.parse(raw, []) as ParsedWithBelief
    expect(r.action).toEqual({ type: 'night/witchSave' })
  })

  it('rejects witchPoison with non-string non-null targetId', () => {
    const raw = `<action>{"type":"night/witchPoison","targetId":42}</action>`
    const r = parser.parse(raw, []) as ParsedWithBelief
    expect(r.fallbackUsed).toBe(true)
  })

  it('caps day/speak content to 200 chars', () => {
    const longContent = 'x'.repeat(500)
    const raw = `<action>{"type":"day/speak","content":"${longContent}"}</action>`
    const r = parser.parse(raw, []) as ParsedWithBelief
    expect(r.action).toMatchObject({ type: 'day/speak' })
    expect((r.action as { content: string }).content.length).toBe(200)
  })

  it('normalizes claimedRole to undefined when unknown', () => {
    const raw = `<action>{"type":"day/speak","content":"hi","claimedRole":"captain"}</action>`
    const r = parser.parse(raw, []) as ParsedWithBelief
    expect((r.action as { claimedRole?: string }).claimedRole).toBeUndefined()
  })
})
