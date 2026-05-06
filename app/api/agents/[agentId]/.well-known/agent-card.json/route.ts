import { loadEnv } from '@/lib/env'

export const runtime = 'nodejs'

type AgentCard = {
  protocolVersion: string
  name: string
  description: string
  version: string
  url: string
  capabilities: {
    streaming: boolean
    pushNotifications: boolean
    stateTransitionHistory: boolean
  }
  skills: Array<{
    id: string
    name: string
    description: string
    tags: string[]
    inputModes: string[]
    outputModes: string[]
  }>
  defaultInputModes: string[]
  defaultOutputModes: string[]
}

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
  const buildCard = TOY_AGENTS[agentId]

  if (!buildCard) {
    return Response.json({ error: `unknown agent: ${agentId}` }, { status: 404 })
  }

  return Response.json(buildCard())
}
