/**
 * FR-4.7-02 赛后解说（R3-4）——客户端触发的单次 LLM 调用。
 *
 * 密钥口径（FR-4.1 / NFR-07）：服务端对局 keyring 在 finalize 时已删除
 * （match-lifecycle.ts），赛后解说不可能依赖服务端留存密钥。前端从浏览器
 * keyring 取某位参赛 Profile 的 apiKey 随请求体传入；本端点只把它用于
 * 这一次 LLM 调用——不写 DB / Redis，不进日志，响应与留存事件中均无密钥。
 *
 * 不虚构的执行：digest 只由真实事件流 + finalRanking 构造；LLM 输出经
 * validateCommentaryResponse 逐条校验 highlight.seq 真实存在，过半无效
 * 整体 422；通过后以 `match/commentary` 公共事件留存（FR-4.8-02），
 * 重新生成即追加新事件（UI 取最新一条）。
 */

import { z } from 'zod'
import { runDecision, type LlmRuntimeProfile } from '@/backend/agent/llm-runtime'
import { recordLlmUsage } from '@/backend/agent/usage-capture'
import { LlmError } from '@/backend/agent/llm-errors'
import {
  baseUrlHost,
  buildCommentaryDigest,
  buildCommentaryEvent,
  buildCommentaryPrompt,
  validateCommentaryResponse,
} from '@/backend/match/commentary'
import { findAgentById } from '@/platform/db/queries/agents'
import { appendEvent, listMatchEvents, nextSeq } from '@/platform/db/queries/events'
import { findMatchById, listParticipants } from '@/platform/db/queries/matches'
import { findProfileById } from '@/platform/db/queries/profiles'
import type { GameType } from '@/platform/core/types'
import { findProvider } from '@/platform/llm/catalog'
import { log } from '@/platform/telemetry/logger'

export const runtime = 'nodejs'

const bodySchema = z.object({
  apiKey: z.string().min(1),
  /** 优先：按 Profile 查 baseUrl/model/providerId（key 仍只来自请求体）。 */
  profileId: z.string().min(1).optional(),
  /** 直连模式（Profile 已被删除等场景）：显式提供 baseUrl + model。 */
  baseUrl: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
})

const COMMENTARY_TIMEOUT_MS = 120_000

export async function POST(req: Request, context: { params: Promise<{ matchId: string }> }): Promise<Response> {
  const { matchId } = await context.params
  const json = await req.json().catch(() => null)
  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) {
    return Response.json({ error: 'invalid body', details: parsed.error.flatten() }, { status: 400 })
  }
  const { apiKey, profileId, baseUrl, model } = parsed.data

  const match = await findMatchById(matchId)
  if (!match) return Response.json({ error: 'match not found' }, { status: 404 })
  if (match.status === 'running' || match.status === 'pending') {
    return Response.json({ error: 'match not finished', code: 'match_running' }, { status: 409 })
  }

  // ── 解析 LLM 凭据（仅本次调用使用；不持久化）────────────────────────
  let runtimeProfile: LlmRuntimeProfile
  if (profileId) {
    const profile = await findProfileById(profileId)
    if (!profile) {
      return Response.json({ error: `unknown profile: ${profileId}`, code: 'profile_not_found' }, { status: 400 })
    }
    runtimeProfile = {
      providerKind: findProvider(profile.providerId)?.kind ?? 'custom',
      providerId: profile.providerId,
      baseUrl: profile.baseUrl,
      apiKey,
      model: profile.model,
    }
  } else {
    if (!baseUrl || !model) {
      return Response.json(
        { error: 'provide either profileId, or baseUrl + model', code: 'credentials_incomplete' },
        { status: 400 },
      )
    }
    try {
      const url = new URL(baseUrl)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('bad protocol')
    } catch {
      return Response.json({ error: `invalid baseUrl: ${baseUrl}`, code: 'invalid_base_url' }, { status: 400 })
    }
    runtimeProfile = { providerKind: 'custom', providerId: 'commentary-direct', baseUrl, apiKey, model }
  }

  // ── 事实素材：留存事件流（终局后全量可见，含 delayed-public）+ 排名 ──
  const events = await listMatchEvents(matchId)
  if (events.length === 0) {
    return Response.json({ error: 'match has no retained events to ground on', code: 'no_events' }, { status: 422 })
  }

  const participants = await listParticipants(matchId)
  const agentNames: Record<string, string> = {}
  await Promise.all(
    participants.map(async (participant) => {
      const agent = await findAgentById(participant.agentId).catch(() => undefined)
      agentNames[participant.agentId] = agent?.displayName ?? participant.agentId
    }),
  )

  const gameType = match.gameType as GameType
  const digest = buildCommentaryDigest({
    matchId,
    gameType,
    events,
    finalRanking: match.finalRanking ?? null,
    agentNames,
  })
  const prompt = buildCommentaryPrompt(digest)

  // ── 单次 LLM 调用 ─────────────────────────────────────────────────────
  let action: unknown
  try {
    const result = await runDecision({
      profile: runtimeProfile,
      agent: { systemPrompt: prompt.systemMessage },
      userPrompt: prompt.userMessage,
      timeoutMs: COMMENTARY_TIMEOUT_MS,
    })
    action = result.action
    // 用量可见（FR-4.8-03）：解说调用也进 llm_usage 流水；失败不影响解说本身。
    void recordLlmUsage({
      matchId,
      agentId: null,
      profileId: profileId ?? null,
      purpose: 'commentary',
      usage: result.usage ?? null,
      model: runtimeProfile.model,
    }).catch(() => {})
  } catch (err) {
    const kind = err instanceof LlmError ? err.kind : 'api_error'
    // 注意：异常信息里不含密钥（runDecision 只包原始错误文本），仍不打印请求体。
    log.warn('commentary LLM call failed', { matchId, kind, err: String(err) })
    return Response.json(
      { error: `commentary LLM call failed (${kind})`, code: `llm_${kind}`, retryable: true },
      { status: 502 },
    )
  }

  // ── 不虚构校验：每条 highlight.seq 必须真实存在 ──────────────────────
  const validation = validateCommentaryResponse({ raw: action, events, rosterAgentIds: digest.rosterAgentIds })
  if (!validation.ok) {
    if (validation.code === 'fabrication') {
      log.warn('commentary rejected: fabricated event seqs', {
        matchId,
        invalidSeqs: validation.invalidSeqs,
        kept: validation.kept,
        dropped: validation.dropped,
      })
      return Response.json(
        {
          error: '解说引用了不存在的事件时刻，已整体拒绝（可重试）',
          code: 'commentary_fabrication',
          invalidSeqs: validation.invalidSeqs,
          retryable: true,
        },
        { status: 422 },
      )
    }
    log.warn('commentary rejected: invalid shape', { matchId, reason: validation.reason })
    return Response.json(
      { error: `解说输出形状不合法：${validation.reason}`, code: 'commentary_invalid_shape', retryable: false },
      { status: 422 },
    )
  }

  // ── 留存（FR-4.8-02）：match/commentary 公共事件，幂等 = 追加新条 ────
  const source = {
    model: runtimeProfile.model,
    providerHost: baseUrlHost(runtimeProfile.baseUrl),
    createdAt: new Date().toISOString(),
  }
  const seq = await nextSeq(matchId)
  const event = buildCommentaryEvent({ matchId, gameType, seq, commentary: validation.commentary, source })
  await appendEvent(event)

  if (validation.droppedHighlights > 0 || validation.droppedMvp) {
    log.info('commentary generated with dropped items', {
      matchId,
      droppedHighlights: validation.droppedHighlights,
      invalidSeqs: validation.invalidSeqs,
      droppedMvp: validation.droppedMvp,
    })
  }

  return Response.json({ matchId, eventSeq: seq, commentary: validation.commentary, source })
}
