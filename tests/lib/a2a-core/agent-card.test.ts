import { describe, expect, it } from 'vitest'
import { buildAgentCard } from '@/lib/a2a-core/agent-card'

describe('buildAgentCard', () => {
  it('returns v0.3 compliant card for poker agent', () => {
    const card = buildAgentCard({
      agent: {
        id: 'agt_1',
        name: 'BluffMaster',
        gameType: 'poker',
        kind: 'player',
        version: '1.0.0',
        description: 'test',
      },
      baseUrl: 'https://x.y',
    })
    expect(card.protocolVersion).toBe('0.3.0')
    expect(card.name).toBe('BluffMaster')
    expect(card.url).toBe('https://x.y/api/agents/agt_1')
    expect(card.capabilities.streaming).toBe(true)
    expect(card.skills[0].id).toBe('poker-decision')
    expect(card.securitySchemes?.apiKey).toBeDefined()
  })

  it('uses werewolf-decision skill for werewolf player', () => {
    const card = buildAgentCard({
      agent: { id: 'a2', name: 'W', gameType: 'werewolf', kind: 'player' },
      baseUrl: 'https://x.y',
    })
    expect(card.skills[0].id).toBe('werewolf-decision')
  })

  it('uses werewolf-moderator skill for werewolf moderator', () => {
    const card = buildAgentCard({
      agent: { id: 'm1', name: 'Judge', gameType: 'werewolf', kind: 'moderator' },
      baseUrl: 'https://x.y',
    })
    expect(card.skills[0].id).toBe('werewolf-moderator')
  })

  it('defaults version to 1.0.0 and description to "<gameType> agent"', () => {
    const card = buildAgentCard({
      agent: { id: 'agt_3', name: 'X', gameType: 'poker', kind: 'player' },
      baseUrl: 'https://x.y',
    })
    expect(card.version).toBe('1.0.0')
    expect(card.description).toBe('poker agent')
  })
})
