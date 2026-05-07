import type { AgentCard } from '@a2a-js/sdk'
import { loadEnv } from '@/lib/env'
import { findAgentById } from '@/lib/db/queries/agents'
import { buildAgentCard } from '@/lib/a2a-core/agent-card'

export const runtime = 'nodejs'

const TOY_AGENTS: Record<string, () => AgentCard> = {
  'toy-poker': () => ({
    protocolVersion: '0.3.0',
    name: 'toy-poker',
    description: 'Phase 0 toy poker agent that always returns a fold decision.',
    version: '0.0.1',
    url: `${loadEnv().BASE_URL}/api/agents/toy-poker`,
    capabilities: {
      streaming: true,
      pushNotifications: false,
      stateTransitionHistory: false,
    },
    skills: [
      {
        id: 'poker-decision',
        name: 'Toy Poker Decision',
        description: 'Always folds for pipeline validation.',
        tags: ['poker', 'toy'],
        inputModes: ['application/json'],
        outputModes: ['application/json'],
      },
    ],
    defaultInputModes: ['application/json'],
    defaultOutputModes: ['application/json'],
  }),
  'toy-echo': () => ({
    protocolVersion: '0.3.0',
    name: 'toy-echo',
    description: 'Phase 0 toy echo agent for validating streaming responses.',
    version: '0.0.1',
    url: `${loadEnv().BASE_URL}/api/agents/toy-echo`,
    capabilities: {
      streaming: true,
      pushNotifications: false,
      stateTransitionHistory: false,
    },
    skills: [
      {
        id: 'echo',
        name: 'Echo',
        description: 'Echoes input data back through the toy A2A stream.',
        tags: ['toy'],
        inputModes: ['application/json'],
        outputModes: ['application/json'],
      },
    ],
    defaultInputModes: ['application/json'],
    defaultOutputModes: ['application/json'],
  }),
}

export async function GET(
  _req: Request,
  context: { params: Promise<{ agentId: string }> },
): Promise<Response> {
  const { agentId } = await context.params
  const buildToyCard = TOY_AGENTS[agentId]

  if (buildToyCard) {
    return Response.json(buildToyCard())
  }

  if (!agentId.startsWith('agt_')) {
    return Response.json({ error: `agent not found: ${agentId}` }, { status: 404 })
  }

  const agent = await findAgentById(agentId).catch(() => undefined)
  if (!agent) {
    return Response.json({ error: `agent not found: ${agentId}` }, { status: 404 })
  }

  const env = loadEnv()
  if (agent.gameType !== 'poker' && agent.gameType !== 'werewolf') {
    return Response.json({ error: `unsupported gameType: ${agent.gameType}` }, { status: 400 })
  }
  if (agent.kind !== 'player' && agent.kind !== 'moderator') {
    return Response.json({ error: `unsupported kind: ${agent.kind}` }, { status: 400 })
  }
  const card = buildAgentCard({
    agent: {
      id: agent.id,
      name: agent.displayName,
      gameType: agent.gameType,
      kind: agent.kind,
      description: agent.systemPrompt.slice(0, 200),
    },
    baseUrl: env.BASE_URL,
  })
  return Response.json(card)
}
