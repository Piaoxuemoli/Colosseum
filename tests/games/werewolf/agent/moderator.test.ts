import { describe, expect, it } from 'vitest'
import { WerewolfModeratorContextBuilder } from '@/games/werewolf/agent/moderator-context'
import { parseModeratorResponse } from '@/games/werewolf/agent/moderator-parser'
import { makeBaseState } from '../engine/_helpers'

describe('WerewolfModeratorContextBuilder', () => {
  const builder = new WerewolfModeratorContextBuilder()

  it('system message declares the no-decision role + 80-char narration limit', () => {
    const r = builder.build({
      agent: { id: 'mod', systemPrompt: '保持庄重' },
      gameState: { ...makeBaseState(), phase: 'night/werewolfKill' as const, currentActor: 'w1' },
      recentEvents: [],
    })
    expect(r.systemMessage).toContain('不参与决策')
    expect(r.systemMessage).toContain('80 字')
    expect(r.systemMessage).toContain('<narration>')
  })

  it('user message mentions upcoming phase + alive count', () => {
    const r = builder.build({
      agent: { id: 'mod', systemPrompt: '' },
      gameState: { ...makeBaseState(), phase: 'day/announce' as const, day: 2 },
      recentEvents: [],
    })
    expect(r.userMessage).toContain('第 2 天')
    expect(r.userMessage).toContain('day/announce')
  })

  it('lists the most recent 8 public event kinds', () => {
    const events = Array.from({ length: 12 }, (_, i) => ({ kind: `werewolf/evt-${i}` }))
    const r = builder.build({
      agent: { id: 'mod', systemPrompt: '' },
      gameState: { ...makeBaseState(), phase: 'day/speak' as const },
      recentEvents: events,
    })
    expect(r.userMessage).toContain('werewolf/evt-11')
    expect(r.userMessage).toContain('werewolf/evt-4') // last 8 start at index 4
    expect(r.userMessage).not.toContain('werewolf/evt-3')
  })
})

describe('parseModeratorResponse', () => {
  it('extracts narration inside tag', () => {
    expect(parseModeratorResponse('<narration>夜幕降临，请闭眼。</narration>').narration).toBe(
      '夜幕降临，请闭眼。',
    )
  })

  it('reports missing tag but falls back to truncated raw text', () => {
    const r = parseModeratorResponse('just a raw narration without tags but under 80 chars')
    expect(r.error).toBe('narration-tag-missing')
    expect(r.narration.length).toBeLessThanOrEqual(80)
  })

  it('truncates over-long narration and marks too-long', () => {
    const r = parseModeratorResponse(`<narration>${'字'.repeat(200)}</narration>`)
    expect(r.error).toBe('too-long')
    expect(r.narration.length).toBeLessThanOrEqual(120)
  })

  it('is case-insensitive to the narration tag', () => {
    expect(parseModeratorResponse('<NARRATION>x</Narration>').narration).toBe('x')
  })
})
