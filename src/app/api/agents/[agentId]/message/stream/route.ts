import { streamText } from 'ai'
import { z } from 'zod'
import { createA2AStreamResponse } from '@/backend/a2a-core/server-helpers'
import { parseRpcRequest, rpcError, RpcErrors } from '@/backend/a2a-core/jsonrpc'
import { getApiKey } from '@/backend/agent/key-cache'
import { LlmError } from '@/backend/agent/llm-errors'
import { runDecision } from '@/backend/agent/llm-runtime'
import { gameTypeSchema } from '@/platform/core/types'
import { findAgentById } from '@/platform/db/queries/agents'
import { recordAgentError } from '@/platform/db/queries/errors'
import { findProfileById } from '@/platform/db/queries/profiles'
import { loadEnv } from '@/platform/env'
import { ensureGamesRegistered } from '@/platform/instrument'
import { findProvider } from '@/platform/llm/catalog'
import { createModel } from '@/platform/llm/provider-factory'
import { getV2ContextBuilder, getV2ResponseParser } from '@/backend/agent/v2-agent-branch'
import type { V2AgentDecisionData } from '@/platform/engine/contracts-v2'
import { validateMatchToken } from '@/backend/orchestrator/match-token'
import { log } from '@/platform/telemetry/logger'

export const runtime = 'nodejs'

function isActionLike(value: unknown): value is { type: string } {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string'
}

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

/**
 * A2A v0.3 exposes `message/stream` via JSON-RPC. Next.js route path segments
 * cannot contain a colon, so the physical path uses `/message/stream` but the
 * JSON-RPC `method` string is still `"message/stream"`. This was documented in
 * the A2A compliance plan, now archived under `docs/legacy/`.
 *
 * This route accepts BOTH shapes for backward compatibility:
 * 1. Direct body  : `{ message: { taskId, role, parts } }` (legacy GM path)
 * 2. JSON-RPC     : `{ jsonrpc:"2.0", id, method:"message/stream",
 *                      params: { message, matchId? } }` (A2A v0.3 spec)
 */
function unwrapBody(raw: unknown): {
  shape: 'direct' | 'jsonrpc'
  rpcId: number | string | null
  inner: unknown
} | { shape: 'error'; status: number; body: unknown } {
  if (typeof raw !== 'object' || raw === null) {
    return { shape: 'error', status: 400, body: { error: 'invalid json body' } }
  }
  const o = raw as Record<string, unknown>
  if (o.jsonrpc === '2.0') {
    const rpc = parseRpcRequest(raw)
    if (!rpc.ok) {
      return {
        shape: 'error',
        status: 400,
        body: { jsonrpc: '2.0', id: null, error: rpc.error },
      }
    }
    if (rpc.value.method !== 'message/stream') {
      return {
        shape: 'error',
        status: 404,
        body: rpcError(rpc.value.id, RpcErrors.METHOD_NOT_FOUND, rpc.value.method),
      }
    }
    return { shape: 'jsonrpc', rpcId: rpc.value.id, inner: rpc.value.params }
  }
  return { shape: 'direct', rpcId: null, inner: raw }
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
  const unwrapped = unwrapBody(json)
  if (unwrapped.shape === 'error') {
    return Response.json(unwrapped.body, { status: unwrapped.status })
  }
  const parsed = messageSchema.safeParse(unwrapped.inner)
  if (!parsed.success) {
    const errPayload = { error: 'invalid body', details: parsed.error.flatten() }
    if (unwrapped.shape === 'jsonrpc') {
      return Response.json(
        rpcError(unwrapped.rpcId, RpcErrors.INVALID_PARAMS, 'invalid params', errPayload),
        { status: 400 },
      )
    }
    return Response.json(errPayload, { status: 400 })
  }

  if (handler) {
    return handler({ body: parsed.data, env: loadEnv() })
  }

  if (!agentId.startsWith('agt_')) {
    return Response.json({ error: `unknown agent: ${agentId}` }, { status: 404 })
  }

  const agent = await findAgentById(agentId).catch(() => undefined)
  if (!agent) return Response.json({ error: `unknown agent: ${agentId}` }, { status: 404 })

  const matchId =
    (unwrapped.shape === 'jsonrpc'
      ? ((unwrapped.inner as { matchId?: unknown } | null | undefined)?.matchId as string | null | undefined)
      : null) ?? req.headers.get('X-Match-Id')
  const token = req.headers.get('X-Match-Token')
  const tokenContext = await validateMatchToken(matchId, token, agentId)
  if (!tokenContext) {
    if (unwrapped.shape === 'jsonrpc') {
      return Response.json(
        rpcError(unwrapped.rpcId, RpcErrors.UNAUTHORIZED, 'invalid match token'),
        { status: 401 },
      )
    }
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  const gameType = gameTypeSchema.parse(agent.gameType)

  // ── engine2 v2 唯一分支（spec §4）：消息自带全部决策输入，不读 Redis 状态。
  //    v1 分支（读 state + botStrategy/responseParser 三层链）已随旧引擎删除；
  //    缺 engineVersion 的消息同样按 v2 处理，缺省字段按空集容错，
  //    非法动作由 GM 侧 normalizeAction → applyDefaultAction 兜底。──
  const dataPart = parsed.data.message.parts.find((part) => part.kind === 'data')
  const decisionData = dataPart?.kind === 'data' ? dataPart.data : undefined
  return runV2DecisionBranch({
    agentId,
    agent: { systemPrompt: agent.systemPrompt, displayName: agent.displayName },
    gameType,
    matchId: tokenContext.matchId,
    data: decisionData ?? {},
    taskId: parsed.data.message.taskId,
  })
}

/**
 * engine2 v2 决策分支（spec §4）：prompt 只由消息 data（可见事件流 +
 * 合法动作 + 机械量）构成；解析器输出原始动作对象，GM 侧 normalizeAction
 * 是最终裁决——本分支不做引擎校验，失败时返回 action=null 交 GM 兜底。
 */
async function runV2DecisionBranch(input: {
  agentId: string
  agent: { systemPrompt: string; displayName: string }
  gameType: string
  matchId: string
  data: Record<string, unknown>
  taskId: string
}): Promise<Response> {
  const decisionData: V2AgentDecisionData = {
    engineVersion: 2,
    events: Array.isArray(input.data.events) ? (input.data.events as Record<string, unknown>[]) : [],
    legalActions: Array.isArray(input.data.legalActions) ? (input.data.legalActions as V2AgentDecisionData['legalActions']) : [],
    decisionContext:
      typeof input.data.decisionContext === 'object' && input.data.decisionContext !== null
        ? (input.data.decisionContext as Record<string, unknown>)
        : {},
    gameInfo:
      typeof input.data.gameInfo === 'object' && input.data.gameInfo !== null
        ? (input.data.gameInfo as Record<string, unknown>)
        : {},
  }

  return createA2AStreamResponse({
    taskId: input.taskId,
    async execute(emit) {
      emit.statusUpdate('working')
      try {
        const agentProfile = await findAgentById(input.agentId).catch(() => undefined)
        const profile = agentProfile ? await findProfileById(agentProfile.profileId).catch(() => undefined) : undefined
        const apiKey = profile ? await getApiKey(input.matchId, profile.id) : undefined
        const provider = profile ? findProvider(profile.providerId) : undefined

        if (!profile || !apiKey) {
          await recordFallbackError({
            matchId: input.matchId,
            agentId: input.agentId,
            errorCode: !profile ? 'llm-profile-missing' : 'llm-api-key-missing',
            recoveryAction: null,
          })
          emit.artifactUpdate({
            parts: [{ kind: 'text', text: `[${input.agent.displayName}] 缺少 LLM 配置，交由引擎默认动作兜底。` }],
            delta: true,
          })
          emit.artifactUpdate({
            parts: [
              {
                kind: 'data',
                data: {
                  action: null,
                  thinking: 'bot fallback',
                  fallback: true,
                  errorKind: !profile ? 'llm-profile-missing' : 'llm-api-key-missing',
                },
              },
            ],
            delta: false,
          })
          emit.statusUpdate('completed')
          return
        }

        const builder = getV2ContextBuilder(input.gameType)
        const prompt = builder.build({
          agent: { id: input.agentId, systemPrompt: input.agent.systemPrompt },
          data: decisionData,
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

        const parser = getV2ResponseParser(input.gameType)
        const parsed = parser.parse(result.rawResponse)
        // 通用流解析器可能已提取合法 <action> JSON——解析器失败时不丢弃它
        const candidate =
          parsed.action ?? (isActionLike(result.action) ? (result.action as Record<string, unknown>) : null)
        const isFallback = candidate === null
        if (isFallback) {
          await recordFallbackError({
            matchId: input.matchId,
            agentId: input.agentId,
            errorCode: 'llm-invalid-action',
            rawResponse: result.rawResponse,
            recoveryAction: null,
          })
        }
        emit.artifactUpdate({
          parts: [
            {
              kind: 'data',
              data: {
                action: candidate,
                thinking: result.thinkingText || parsed.thinking,
                fallback: isFallback,
                ...(isFallback ? { errorKind: 'llm-invalid-action' } : {}),
              },
            },
          ],
          delta: false,
        })
        emit.statusUpdate('completed')
      } catch (err) {
        const errorKind = llmErrorKind(err) ?? 'api_error'
        await recordFallbackError({
          matchId: input.matchId,
          agentId: input.agentId,
          errorCode: `llm-${errorKind}`,
          rawResponse: rawResponseFromError(err),
          recoveryAction: null,
        })
        log.warn('agent endpoint v2 branch: LLM failure, engine default will be applied by GM', {
          agentId: input.agentId,
          matchId: input.matchId,
          errorKind,
          err: String(err),
        })
        emit.artifactUpdate({
          parts: [{ kind: 'text', text: `[${input.agent.displayName}] LLM 失败，交由引擎默认动作兜底。` }],
          delta: true,
        })
        emit.artifactUpdate({
          parts: [
            {
              kind: 'data',
              data: { action: null, thinking: 'bot fallback', fallback: true, errorKind: `llm-${errorKind}` },
            },
          ],
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
