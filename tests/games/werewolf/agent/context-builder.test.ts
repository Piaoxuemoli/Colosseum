import { describe, expect, it } from 'vitest'
import { WerewolfPlayerContextBuilder } from '@/games/werewolf/agent/context-builder'
import type { MemoryContextSnapshot } from '@/lib/memory/contracts'
import { makeBaseState } from '../engine/_helpers'

const emptyMemory: MemoryContextSnapshot = {
  workingSummary: '',
  episodicSection: '',
  semanticSection: '',
}

describe('WerewolfPlayerContextBuilder', () => {
  const builder = new WerewolfPlayerContextBuilder()

  it('discloses wolf teammates to a wolf agent', () => {
    const state = { ...makeBaseState(), phase: 'night/werewolfDiscussion' as const, currentActor: 'w1' }
    const r = builder.build({
      agent: { id: 'w1', systemPrompt: '严谨推理' },
      gameState: state,
      validActions: [],
      memoryContext: emptyMemory,
    })
    expect(r.systemMessage).toContain('狼人')
    expect(r.systemMessage).toContain('w2') // teammate
  })

  it("surfaces seer's previous check results", () => {
    const state = {
      ...makeBaseState(),
      phase: 'night/seerCheck' as const,
      currentActor: 's',
      seerCheckResults: [
        { day: 0, targetId: 'v1', role: 'werewolf' as const },
        { day: 1, targetId: 'v2', role: 'villager' as const },
      ],
    }
    const r = builder.build({
      agent: { id: 's', systemPrompt: '' },
      gameState: state,
      validActions: [],
      memoryContext: emptyMemory,
    })
    expect(r.systemMessage).toContain('预言家')
    expect(r.systemMessage).toContain('第0天查 v1 = 狼人')
    expect(r.systemMessage).toContain('第1天查 v2 = 平民')
  })

  it('tells witch about her potion stock', () => {
    const state = {
      ...makeBaseState(),
      phase: 'night/witchAction' as const,
      currentActor: 'wi',
      witchPotions: { save: true, poison: false },
    }
    const r = builder.build({
      agent: { id: 'wi', systemPrompt: '' },
      gameState: state,
      validActions: [],
      memoryContext: emptyMemory,
    })
    expect(r.systemMessage).toContain('女巫')
    expect(r.systemMessage).toContain('救药 剩')
    expect(r.systemMessage).toContain('毒药 已用')
  })

  it('gives villager a no-ability hint (no private info leak)', () => {
    const state = { ...makeBaseState(), phase: 'day/speak' as const, currentActor: 'v1' }
    const r = builder.build({
      agent: { id: 'v1', systemPrompt: '' },
      gameState: state,
      validActions: [],
      memoryContext: emptyMemory,
    })
    expect(r.systemMessage).toContain('平民')
    expect(r.systemMessage).toContain('无特殊能力')
    expect(r.systemMessage).not.toContain('狼队友')
    expect(r.systemMessage).not.toContain('验人')
    expect(r.systemMessage).not.toContain('救药')
  })

  it('lists alive players and dead players in user message', () => {
    const base = makeBaseState()
    const state = {
      ...base,
      day: 2,
      phase: 'day/speak' as const,
      currentActor: 'v1',
      players: base.players.map((p) =>
        p.agentId === 'v2' ? { ...p, alive: false, deathDay: 1, deathCause: 'werewolfKill' as const } : p,
      ),
    }
    const r = builder.build({
      agent: { id: 'v1', systemPrompt: '' },
      gameState: state,
      validActions: [],
      memoryContext: emptyMemory,
    })
    expect(r.userMessage).toMatch(/第 2 天/)
    expect(r.userMessage).toContain('V2(第1天 werewolfKill)')
  })

  it('enforces the three-tag output contract', () => {
    const state = { ...makeBaseState(), phase: 'day/speak' as const, currentActor: 'v1' }
    const r = builder.build({
      agent: { id: 'v1', systemPrompt: '' },
      gameState: state,
      validActions: [],
      memoryContext: emptyMemory,
    })
    expect(r.systemMessage).toContain('<thinking>')
    expect(r.systemMessage).toContain('<belief>')
    expect(r.systemMessage).toContain('<action>')
  })

  it('injects semantic + episodic memory sections when present', () => {
    const state = { ...makeBaseState(), phase: 'day/speak' as const, currentActor: 'v1' }
    const r = builder.build({
      agent: { id: 'v1', systemPrompt: '' },
      gameState: state,
      validActions: [],
      memoryContext: {
        workingSummary: '',
        episodicSection: '- 上局狼赢',
        semanticSection: '- w1 倾向激进',
      },
    })
    expect(r.systemMessage).toContain('上局狼赢')
    expect(r.systemMessage).toContain('w1 倾向激进')
  })
})
