import { streamText } from 'ai'
import { z } from 'zod'
import { createA2AStreamResponse } from '@/lib/a2a-core/server-helpers'
import { getGame } from '@/lib/core/registry'
import { gameTypeSchema } from '@/lib/core/types'
import { findAgentById } from '@/lib/db/queries/agents'
import { loadEnv } from '@/lib/env'
import { ensureGamesRegistered } from '@/lib/instrument'
import { createModel } from '@/lib/llm/provider-factory'
import { validateMatchToken } from '@/lib/orchestrator/match-token'
import { redis } from '@/lib/redis/client'
import { keys } from '@/lib/redis/keys'
import { log } from '@/lib/telemetry/logger'

export const runtime = 'nodejs'

const messageSchema = z.object({
  message: z.object({
    messageId: z.string(),
    taskId: z.string(),
    role: z.enum(['user', 'system']),
    parts: z.array(
      z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('text'), text: z.string() }),
        z.object({ kind: z.literal('data'), data: z.record(z.string(), z.unknown()) }),
      ]),
    ),
  }),
})

type ToyHandlerInput = {
  body: z.infer<typeof messageSchema>
  env: ReturnType<typeof loadEnv>
}

type ToyHandler = (input: ToyHandlerInput) => Promise<Response>

const toyAgents: Record<string, ToyHandler> = {
  'toy-poker': async ({ body }) =>
    createA2AStreamResponse({
      taskId: body.message.taskId,
      async execute(emit) {
        emit.statusUpdate('working')
        for (const chunk of ['正在评估牌面...', ' 对手似乎很紧...', ' 决定弃牌。']) {
          emit.artifactUpdate({ parts: [{ kind: 'text', text: chunk }], delta: true })
          await new Promise((resolve) => setTimeout(resolve, 1))
        }
        emit.artifactUpdate({
          parts: [{ kind: 'data', data: { action: 'fold', reasoning: 'toy' } }],
          delta: false,
        })
        emit.statusUpdate('completed')
      },
    }),

  'toy-echo': async ({ body, env }) => {
    const taskId = body.message.taskId
    const dataPart = body.message.parts.find((part) => part.kind === 'data')
    const prompt = dataPart?.kind === 'data' ? JSON.stringify(dataPart.data) : 'hi'

    if (!env.TEST_LLM_BASE_URL || !env.TEST_LLM_API_KEY || !env.TEST_LLM_MODEL) {
      return createA2AStreamResponse({
        taskId,
        async execute(emit) {
          emit.statusUpdate('working')
          emit.artifactUpdate({ parts: [{ kind: 'text', text: 'No LLM configured.' }], delta: true })
          emit.artifactUpdate({
            parts: [{ kind: 'data', data: { echoed: prompt, note: 'no LLM configured' } }],
            delta: false,
          })
          emit.statusUpdate('completed')
        },
      })
    }

    const model = createModel({
      kind: 'openai-compatible',
      providerId: 'test-llm',
      baseUrl: env.TEST_LLM_BASE_URL,
      model: env.TEST_LLM_MODEL,
      apiKey: env.TEST_LLM_API_KEY,
    })

    return createA2AStreamResponse({
      taskId,
      async execute(emit) {
        emit.statusUpdate('working')
        let fullText = ''
        try {
          const result = streamText({
            model,
            messages: [{ role: 'user', content: `Echo this back with a brief comment: ${prompt}` }],
          })
          for await (const delta of result.textStream) {
            fullText += delta
            emit.artifactUpdate({ parts: [{ kind: 'text', text: delta }], delta: true })
          }
        } catch (err) {
          log.error('toy echo LLM call failed', { err: String(err) })
          emit.artifactUpdate({ parts: [{ kind: 'text', text: `[error: ${String(err)}]` }], delta: true })
        }
        emit.artifactUpdate({
          parts: [{ kind: 'data', data: { echoed: prompt, llmText: fullText } }],
          delta: false,
        })
        emit.statusUpdate('completed')
      },
    })
  },
}

export async function POST(
  req: Request,
  context: { params: Promise<{ agentId: string }> },
): Promise<Response> {
  ensureGamesRegistered()
  const { agentId } = await context.params
  const handler = toyAgents[agentId]

  const json = await req.json().catch(() => null)
  const parsed = messageSchema.safeParse(json)
  if (!parsed.success) {
    return Response.json({ error: 'invalid body', details: parsed.error.flatten() }, { status: 400 })
  }

  if (handler) {
    return handler({ body: parsed.data, env: loadEnv() })
  }

  if (!agentId.startsWith('agt_')) {
    return Response.json({ error: `unknown agent: ${agentId}` }, { status: 404 })
  }

  const agent = await findAgentById(agentId).catch(() => undefined)
  if (!agent) return Response.json({ error: `unknown agent: ${agentId}` }, { status: 404 })

  const matchId = req.headers.get('X-Match-Id')
  const token = req.headers.get('X-Match-Token')
  const tokenContext = await validateMatchToken(matchId, token, agentId)
  if (!tokenContext) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const gameType = gameTypeSchema.parse(agent.gameType)
  const game = getGame(gameType)
  const stateRaw = await redis.get(keys.matchState(tokenContext.matchId))
  if (!stateRaw) return Response.json({ error: 'match state missing' }, { status: 410 })

  const state = JSON.parse(stateRaw) as unknown
  const validActions = game.engine.availableActions(state, agentId)

  return createA2AStreamResponse({
    taskId: parsed.data.message.taskId,
    async execute(emit) {
      emit.statusUpdate('working')
      try {
        const action = game.botStrategy.decide(state, validActions as unknown[])
        emit.artifactUpdate({
          parts: [{ kind: 'text', text: `[${agent.displayName}] 根据当前局面生成规则决策...` }],
          delta: true,
        })
        await new Promise((resolve) => setTimeout(resolve, 1))
        emit.artifactUpdate({
          parts: [{ kind: 'data', data: { action, thinking: 'bot rule-based' } }],
          delta: false,
        })
        emit.statusUpdate('completed')
      } catch (err) {
        log.error('agent endpoint failed', { agentId, matchId: tokenContext.matchId, err: String(err) })
        emit.statusUpdate('failed', String(err))
      }
    },
  })
}
