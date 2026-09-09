/**
 * FR-4.7-01 AI 主持人旁白（R3-3）：GM tick 在关键公开边界后的 LLM 旁白编排。
 *
 * 分工：
 * - 触发判定与「仅公开信息」digest 由游戏侧纯函数承担（本模块按 gameType
 *   装配，werewolf = games/werewolf/integration/narration.ts；poker 无旁白）；
 * - 本模块负责：narrationEnabled 总闸（关 = 完全不打 LLM）、主持人 Agent /
 *   Profile / 服务端 keyring 解析、prompt 组装（人设 + 不虚构不剧透铁律 +
 *   公开 digest）、llm-runtime.runNarration 轻量调用（≤80 字正文、低
 *   maxTokens、30s 短超时）、`werewolf:v2:moderatorNarration` 公共事件构造
 *   （seq 经 GM 传入的 reserveEventSeq 预留，与 agent/thinking 同机制）。
 *
 * 语义约束（旁白是增强项，绝不阻塞对局）：模块内任何失败——主持人缺失、
 * 无 key、LLM 报错 / 超时 / 空输出——一律 debug 日志 + 返回 null，GM 照常
 * 推进 tick。LLM 不可用就没有旁白事件（流程性宣告已由 engine2 announce
 * 事件承载事实，无罐头文案兜底）。
 */

import { runNarration } from '@/backend/agent/llm-runtime'
import { recordLlmUsage } from '@/backend/agent/usage-capture'
import { getApiKey } from '@/backend/agent/key-cache'
import { avalonNarrationTrigger } from '@/games/avalon/integration/narration'
import { werewolfNarrationTrigger, type WerewolfNarrationTrigger } from '@/games/werewolf/integration/narration'
import { newEventId } from '@/platform/core/ids'
import type { GameEvent, GameType } from '@/platform/core/types'
import type { V2Event } from '@/platform/engine/contracts-v2'
import { findAgentById, listAgents } from '@/platform/db/queries/agents'
import { findProfileById } from '@/platform/db/queries/profiles'
import { loadEnv } from '@/platform/env'
import { findProvider } from '@/platform/llm/catalog'
import { log } from '@/platform/telemetry/logger'
import { isNarrationEnabled } from './narration-gate'

/** 事件 kind：信封化为 `${gameType}:v2:moderatorNarration`（audience public）。 */
export const NARRATION_ENGINE_KIND = 'moderatorNarration'

export const NARRATION_TIMEOUT_MS = 30_000
export const NARRATION_MAX_OUTPUT_TOKENS = 256
export const NARRATION_MAX_TEXT_CHARS = 200

// ---------------------------------------------------------------------------
// gameType 装配（backend → games，与 v2-agent-branch 同模式；GM 无游戏分支）
// ---------------------------------------------------------------------------

export type NarrationTriggerFn = (
  state: unknown,
  batch: readonly V2Event[],
  context: readonly Record<string, unknown>[],
) => WerewolfNarrationTrigger | null

const NARRATION_TRIGGERS: Partial<Record<GameType, NarrationTriggerFn>> = {
  werewolf: werewolfNarrationTrigger as NarrationTriggerFn,
  avalon: avalonNarrationTrigger as NarrationTriggerFn,
}

/** 该品类是否有旁白触发器（poker 无 → 调用方零成本直通）。 */
export function narrationTriggerFor(gameType: string): NarrationTriggerFn | null {
  return NARRATION_TRIGGERS[gameType as GameType] ?? null
}

// ---------------------------------------------------------------------------
// Prompt 组装（纯函数，导出供测试）
// ---------------------------------------------------------------------------

const GAME_LABELS: Record<string, string> = { poker: '德州扑克', werewolf: '狼人杀', avalon: '阿瓦隆' }

export function buildNarrationPrompt(input: {
  gameType: GameType
  moderatorSystemPrompt: string
  trigger: WerewolfNarrationTrigger
}): { systemMessage: string; userMessage: string } {
  const gameLabel = GAME_LABELS[input.gameType] ?? '博弈'
  const systemMessage = [
    input.moderatorSystemPrompt.trim(),
    '',
    `你正在为一场进行中的${gameLabel}对局撰写一句实时解说旁白。铁律：`,
    '1. 仅依据随后给出的「公开事实清单」写旁白，正文不超过 80 字。',
    '2. 不虚构清单之外的事件、身份、票数、对话或动机。',
    '3. 不剧透任何未公开信息（夜间行动、隐藏身份、上帝视角事实）。',
    '4. 直接输出旁白正文本身，不要前缀、标题、引号或解释。',
  ].join('\n')

  const digest =
    input.trigger.publicDigest.length > 0
      ? input.trigger.publicDigest.map((line) => `- ${line}`).join('\n')
      : '-（本批暂无可述公开事实）'
  const userMessage = [
    '【公开事实清单】（唯一事实来源，按时序列出）',
    digest,
    '',
    `本批关键事件：${input.trigger.focusKinds.join('、')}。请仅依据以上公开事实写不超过 80 字的旁白。`,
  ].join('\n')

  return { systemMessage, userMessage }
}

// ---------------------------------------------------------------------------
// 主持人解析（config.moderatorAgentId 优先；存量对局回落到库内首个主持人）
// ---------------------------------------------------------------------------

type ResolvedModerator = {
  agentId: string
  systemPrompt: string
  profileId: string
  providerId: string
  baseUrl: string
  model: string
  apiKey: string
}

async function resolveModerator(input: {
  matchId: string
  gameType: GameType
  matchConfig: Record<string, unknown> | null | undefined
}): Promise<ResolvedModerator | null> {
  const configId =
    typeof input.matchConfig?.moderatorAgentId === 'string' && input.matchConfig.moderatorAgentId.length > 0
      ? input.matchConfig.moderatorAgentId
      : null

  let agent = configId ? await findAgentById(configId).catch(() => undefined) : undefined
  if (!agent) {
    // 存量对局（config 未持久化 moderatorAgentId）：按 R2-2 种子同口径回落。
    const moderators = await listAgents({ gameType: input.gameType, kind: 'moderator' }).catch(() => [])
    agent = moderators[0]
  }
  if (!agent) {
    log.debug('narration skipped: no moderator agent', { matchId: input.matchId, gameType: input.gameType })
    return null
  }

  const profile = await findProfileById(agent.profileId).catch(() => undefined)
  if (!profile) {
    log.debug('narration skipped: moderator profile missing', { matchId: input.matchId, agentId: agent.id })
    return null
  }

  // 运行中对局可用服务端 keyring（FR-4.1：key 只在 Redis 会话缓存，不落库）。
  const apiKey = await getApiKey(input.matchId, profile.id).catch(() => undefined)
  if (!apiKey) {
    log.debug('narration skipped: no api key in match keyring', {
      matchId: input.matchId,
      profileId: profile.id,
    })
    return null
  }

  return {
    agentId: agent.id,
    systemPrompt: agent.systemPrompt,
    profileId: profile.id,
    providerId: profile.providerId,
    baseUrl: profile.baseUrl,
    model: profile.model,
    apiKey,
  }
}

// ---------------------------------------------------------------------------
// 事件构造（引擎事件本体形态，与 v2 信封 payload 平铺口径一致）
// ---------------------------------------------------------------------------

function narrationEvent(input: {
  matchId: string
  gameType: GameType
  seq: number
  occurredAt: string
  moderatorAgentId: string
  summary: { day: number; phase: string }
  text: string
  triggeredByKinds: readonly string[]
}): GameEvent {
  return {
    id: newEventId(),
    matchId: input.matchId,
    gameType: input.gameType,
    seq: input.seq,
    occurredAt: input.occurredAt,
    kind: `${input.gameType}:v2:${NARRATION_ENGINE_KIND}`,
    actorAgentId: input.moderatorAgentId,
    payload: {
      seq: input.seq,
      day: input.summary.day,
      audience: { kind: 'public' },
      actorId: input.moderatorAgentId,
      kind: NARRATION_ENGINE_KIND,
      payload: {
        text: input.text,
        source: 'llm',
        triggeredByKinds: [...input.triggeredByKinds],
      },
    },
    visibility: 'public',
    restrictedTo: null,
  }
}

// ---------------------------------------------------------------------------
// GM 钩子入口
// ---------------------------------------------------------------------------

export type ModeratorNarrationOutput = {
  event: GameEvent
  /** reserveEventSeq 之后的引擎状态（nextSeq 已前进，GM 必须以它覆写 Redis）。 */
  state: unknown
}

/**
 * 生成一条主持人旁白事件；任何不满足条件 / 任何失败都返回 null（静默跳过）。
 * 唯一会发起 LLM 调用的路径——narrationEnabled=false 时在此提前返回。
 */
export async function generateModeratorNarration(input: {
  matchId: string
  gameType: GameType
  matchConfig: Record<string, unknown> | null | undefined
  /** 批应用后的引擎状态（触发器只用其中的公开事实）。 */
  state: unknown
  batchEvents: readonly V2Event[]
  /** 本批之前已落库的事件本体（仅 public 子集会进入 digest）。 */
  publicContext: readonly Record<string, unknown>[]
  summary: { handNumber: number; day: number; phase: string }
  reserveEventSeq: (state: unknown) => { state: unknown; seq: number }
}): Promise<ModeratorNarrationOutput | null> {
  try {
    // 总闸（R2-2）：关 = 完全不打 LLM（流程性宣告不受影响）。
    if (!isNarrationEnabled(input.matchConfig)) return null

    const triggerFn = narrationTriggerFor(input.gameType)
    if (!triggerFn) return null

    const trigger = triggerFn(input.state, input.batchEvents, input.publicContext)
    if (!trigger) return null

    const moderator = await resolveModerator(input)
    if (!moderator) return null

    const prompt = buildNarrationPrompt({
      gameType: input.gameType,
      moderatorSystemPrompt: moderator.systemPrompt,
      trigger,
    })

    const result = await runNarration({
      profile: {
        providerKind: findProvider(moderator.providerId)?.kind ?? 'custom',
        providerId: moderator.providerId,
        baseUrl: moderator.baseUrl,
        model: moderator.model,
        apiKey: moderator.apiKey,
      },
      systemPrompt: prompt.systemMessage,
      userPrompt: prompt.userMessage,
      timeoutMs: NARRATION_TIMEOUT_MS,
      maxOutputTokens: NARRATION_MAX_OUTPUT_TOKENS,
      maxTextChars: NARRATION_MAX_TEXT_CHARS,
    })

    // FR-4.8-03：成功调用落用量流水（purpose=moderator-narration）；mock 模式
    // 无真实调用不计数（与 agent endpoint 同口径）。recordLlmUsage 内部吞错。
    if (loadEnv().M4_MOCK_LLM !== '1') {
      await recordLlmUsage({
        matchId: input.matchId,
        agentId: moderator.agentId,
        profileId: moderator.profileId,
        purpose: 'moderator-narration',
        model: moderator.model,
        usage: result.usage,
      })
    }

    const reserved = input.reserveEventSeq(input.state)
    return {
      event: narrationEvent({
        matchId: input.matchId,
        gameType: input.gameType,
        seq: reserved.seq,
        occurredAt: new Date().toISOString(),
        moderatorAgentId: moderator.agentId,
        summary: { day: input.summary.day, phase: input.summary.phase },
        text: result.text,
        triggeredByKinds: trigger.focusKinds,
      }),
      state: reserved.state,
    }
  } catch (err) {
    // 旁白是增强项：任何失败静默跳过，绝不阻塞 tick。
    log.debug('moderator narration skipped', {
      matchId: input.matchId,
      gameType: input.gameType,
      err: String(err),
    })
    return null
  }
}
