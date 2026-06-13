import type { AgentCard } from '@a2a-js/sdk'

export interface BuildCardInput {
  agent: {
    id: string
    name: string
    gameType: 'poker' | 'werewolf'
    kind: 'player' | 'moderator'
    version?: string
    description?: string
  }
  baseUrl: string
}

type AgentSkill = NonNullable<AgentCard['skills']>[number]

export function buildAgentCard(input: BuildCardInput): AgentCard {
  const { agent, baseUrl } = input
  const skill = skillFor(agent.gameType, agent.kind)
  return {
    protocolVersion: '0.3.0',
    name: agent.name,
    description: agent.description ?? `${agent.gameType} agent`,
    version: agent.version ?? '1.0.0',
    url: `${baseUrl}/api/agents/${agent.id}`,
    capabilities: { streaming: true, pushNotifications: false, stateTransitionHistory: false },
    skills: [skill],
    defaultInputModes: ['application/json'],
    defaultOutputModes: ['application/json'],
    securitySchemes: {
      apiKey: {
        type: 'apiKey',
        in: 'header',
        name: 'X-Match-Token',
      },
    },
  } as AgentCard
}

function skillFor(gameType: string, kind: string): AgentSkill {
  if (gameType === 'poker') {
    return {
      id: 'poker-decision',
      name: 'Poker Hand Decision',
      description: 'Decide a single poker action',
      tags: ['poker', 'fixed-limit', '6-max'],
      inputModes: ['application/json'],
      outputModes: ['application/json'],
    }
  }
  if (kind === 'moderator') {
    return {
      id: 'werewolf-moderator',
      name: 'Werewolf Moderator Narration',
      description: 'Narrate werewolf phase transitions',
      tags: ['werewolf', 'moderator'],
      inputModes: ['application/json'],
      outputModes: ['application/json'],
    }
  }
  return {
    id: 'werewolf-decision',
    name: 'Werewolf Decision',
    description: 'Decide werewolf night/day action or speech',
    tags: ['werewolf', '6-player'],
    inputModes: ['application/json'],
    outputModes: ['application/json'],
  }
}
