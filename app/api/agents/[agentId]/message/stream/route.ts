import { streamText } from 'ai'
import { z } from 'zod'
import { createA2AStreamResponse } from '@/lib/a2a-core/server-helpers'
import { getApiKey } from '@/lib/agent/key-cache'
import { LlmError } from '@/lib/agent/llm-errors'
import { runDecision } from '@/lib/agent/llm-runtime'
import { getGame } from '@/lib/core/registry'
import { gameTypeSchema } from '@/lib/core/types'
import { findAgentById } from '@/lib/db/queries/agents'
import { recordAgentError } from '@/lib/db/queries/errors'
import { findProfileById } from '@/lib/db/queries/profiles'
import { loadEnv } from '@/lib/env'
import { ensureGamesRegistered } from '@/lib/instrument'
import { findProvider } from '@/lib/llm/catalog'
import { createModel } from '@/lib/llm/provider-factory'
import { coerceToValidAction } from '@/lib/orchestrator/action-validator'
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

const emptyMemoryContext = {
  workingSummary: '',
  episodicSection: '',
  semanticSection: '',
}

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
  const profile = await findProfileById(agent.profileId).catch(() => undefined)
  const apiKey = profile ? await getApiKey(tokenContext.matchId, profile.id) : undefined
  const provider = profile ? findProvider(profile.providerId) : undefined

  return createA2AStreamResponse({
    taskId: parsed.data.message.taskId,
    async execute(emit) {
      emit.statusUpdate('working')
      try {
        if (!profile || !apiKey) {
          const action = game.botStrategy.decide(state, validActions as unknown[])
          await recordFallbackError({
            matchId: tokenContext.matchId,
            agentId,
            errorCode: !profile ? 'llm-profile-missing' : 'llm-api-key-missing',
            recoveryAction: action,
          })
          emit.artifactUpdate({
            parts: [{ kind: 'text', text: `[${agent.displayName}] 缺少 LLM 配置，使用规则兜底。` }],
            delta: true,
          })
          emit.artifactUpdate({
            parts: [{ kind: 'data', data: { action, thinking: 'bot fallback', fallback: true } }],
            delta: false,
          })
          emit.statusUpdate('completed')
          return
        }

        const prompt = game.playerContextBuilder.build({
          agent: { id: agentId, systemPrompt: agent.systemPrompt },
          gameState: state,
          validActions,
          memoryContext: emptyMemoryContext,
        })
        const result = await runDecision({
          profile: {
            providerKind: provider?.kind ?? 'custom',
            providerId: profile.providerId,
            baseUrl: profile.baseUrl,
            apiKey,
            model: profile.model,
          },
          agent: { systemPrompt: prompt.systemMessage },
          userPrompt: prompt.userMessage,
          onThinkingDelta(delta) {
            emit.artifactUpdate({ parts: [{ kind: 'text', text: delta }], delta: true })
          },
        })
        const validated = coerceToValidAction(result.action, validActions, state, game.botStrategy, {
          matchId: tokenContext.matchId,
          agentId,
          layerIfPassed: 'parse',
        })
        if (validated.layer === 'fallback') {
          await recordFallbackError({
            matchId: tokenContext.matchId,
            agentId,
            errorCode: 'llm-invalid-action',
            rawResponse: result.rawResponse,
            recoveryAction: validated.action,
          })
        }
        emit.artifactUpdate({
          parts: [{ kind: 'data', data: { action: validated.action, thinking: result.thinkingText, fallback: validated.layer === 'fallback' } }],
          delta: false,
        })
        emit.statusUpdate('completed')
      } catch (err) {
        const errorKind = llmErrorKind(err) ?? 'api_error'
        const action = game.botStrategy.decide(state, validActions as unknown[])
        await recordFallbackError({
          matchId: tokenContext.matchId,
          agentId,
          errorCode: `llm-${errorKind}`,
          rawResponse: rawResponseFromError(err),
          recoveryAction: action,
        })
        log.warn('agent endpoint used bot fallback after LLM failure', {
          agentId,
          matchId: tokenContext.matchId,
          errorKind,
          err: String(err),
        })
        emit.artifactUpdate({
          parts: [{ kind: 'text', text: `[${agent.displayName}] LLM 失败，使用规则兜底。` }],
          delta: true,
        })
        emit.artifactUpdate({
          parts: [{ kind: 'data', data: { action, thinking: 'bot fallback', fallback: true, errorKind } }],
          delta: false,
        })
        emit.statusUpdate('completed')
      }
    },
  })
}

async function recordFallbackError(input: {
  matchId: string
  agentId: string
  errorCode: string
  rawResponse?: string | null
  recoveryAction: unknown
}): Promise<void> {
  await recordAgentError({
    matchId: input.matchId,
    agentId: input.agentId,
    layer: 'fallback',
    errorCode: input.errorCode,
    rawResponse: input.rawResponse ?? null,
    recoveryAction: toRecord(input.recoveryAction),
  }).catch((err) => {
    log.error('failed to record agent fallback error', { err: String(err), agentId: input.agentId, matchId: input.matchId })
  })
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

function rawResponseFromError(err: unknown): string | null {
  const cause = typeof err === 'object' && err !== null && 'cause' in err ? (err as { cause?: unknown }).cause : null
  if (typeof cause === 'object' && cause !== null && 'rawResponse' in cause) {
    const raw = (cause as { rawResponse?: unknown }).rawResponse
    return typeof raw === 'string' ? raw : null
  }
  return null
}

function llmErrorKind(err: unknown): LlmError['kind'] | null {
  if (err instanceof LlmError) return err.kind
  if (typeof err !== 'object' || err === null || !('kind' in err)) return null
  const kind = (err as { kind?: unknown }).kind
  return kind === 'timeout' || kind === 'api_error' || kind === 'parse_fail' || kind === 'abort' ? kind : null
}
