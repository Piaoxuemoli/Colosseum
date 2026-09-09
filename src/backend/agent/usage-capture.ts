// FR-4.8-03 / NFR-06（R3-6 用量可见）：LLM 调用用量捕获与持久化。
//
// 捕获点：llm-runtime.runDecision 完成后由 agent endpoint 调用本模块写
// `llm_usage` 流水（目的固定为 agent-decision）。主持 / 解说用途的枚举值
// 已在 schema 预留，其捕获点随对应模块落地时再接（本任务不触碰
// orchestrator/game-master 与 backend/match/commentary）。
//
// 安全约定：用量写入失败绝不影响对局推进——recordLlmUsage 内部吞错并
// 记日志，调用方无需 try/catch。

import { newId } from '@/platform/core/ids'
import type { LlmUsagePurpose } from '@/platform/core/types'
import { db as defaultDb, type DB } from '@/platform/db/client'
import { llmUsage } from '@/platform/db/schema.sqlite'
import { log } from '@/platform/telemetry/logger'

/** 用途枚举口径在 platform/core/types.ts（查询层共用）。 */
export type { LlmUsagePurpose }

/** 一次调用捕获到的 token 用量；三项皆 null = 仅有调用次数（供应方未上报）。 */
export type LlmUsageSample = {
  promptTokens: number | null
  completionTokens: number | null
  totalTokens: number | null
}

export const NULL_USAGE: LlmUsageSample = {
  promptTokens: null,
  completionTokens: null,
  totalTokens: null,
}

/**
 * 从 Vercel AI SDK 的 LanguageModelUsage（ai@5 = @ai-sdk/provider@2 的
 * LanguageModelV2Usage：`inputTokens` / `outputTokens` / `totalTokens`，均可
 * undefined）提取可持久化的用量。undefined / 非有限数一律归 null，保证
 * 「供应方未上报」与「上报为 0」可区分。
 */
export function extractUsage(usage: unknown): LlmUsageSample {
  if (typeof usage !== 'object' || usage === null) return { ...NULL_USAGE }
  const pick = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : null
  return {
    promptTokens: pick((usage as { inputTokens?: unknown }).inputTokens),
    completionTokens: pick((usage as { outputTokens?: unknown }).outputTokens),
    totalTokens: pick((usage as { totalTokens?: unknown }).totalTokens),
  }
}

export type RecordLlmUsageInput = {
  matchId: string | null
  agentId: string | null
  profileId: string | null
  purpose: LlmUsagePurpose
  model: string | null
  usage?: LlmUsageSample | null
}

/**
 * 写一条 llm_usage 流水。永不抛错（fire-and-forget-safe）：插入失败只记
 * error 日志，不向上传染到对局 tick / 决策流。
 */
export async function recordLlmUsage(
  input: RecordLlmUsageInput,
  dbh: DB = defaultDb,
): Promise<void> {
  const usage = input.usage ?? NULL_USAGE
  try {
    await dbh.insert(llmUsage).values({
      id: newId(),
      matchId: input.matchId,
      agentId: input.agentId,
      profileId: input.profileId,
      purpose: input.purpose,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
      model: input.model,
      createdAt: new Date(),
    })
  } catch (err) {
    log.error('failed to persist llm usage row', {
      purpose: input.purpose,
      matchId: input.matchId,
      agentId: input.agentId,
      err: String(err),
    })
  }
}
