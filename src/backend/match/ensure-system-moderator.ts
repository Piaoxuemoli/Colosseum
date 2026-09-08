/**
 * 按需落库的系统主持人种子（R2-2 / FR-4.2-02）。
 *
 * `ensureWerewolfModerator` 在 POST /api/matches 创建狼人杀对局前调用：
 * 没带 moderatorAgentId 且库里一个 werewolf 主持人都没有时，用默认模板
 * （prompt-presets 的 neutral-mod）自动创建「系统主持人」。决策逻辑在
 * `moderator-seed.ts`（纯函数），这里只做编排。
 *
 * 幂等性：
 * 1. 查库确认 —— 只要存在任意 kind=moderator 的 werewolf Agent（用户自建
 *    或历史种子）就复用，不再创建。
 * 2. 进程内 in-flight 去重 —— 并发的两笔创建共用同一次种子 Promise，
 *    避免检查-写入竞态产生双份种子；Promise 结束后清空，后续调用仍走
 *    查库路径（用户删掉种子后会按需再补）。
 *
 * agents.profileId 是非空外键，种子绑定「第一个已有 Profile」；连一个
 * Profile 都没有时返回 reason='no-profile'，由既有的
 * `validateWerewolfCreate` 继续抛 400（行为与种子机制引入前一致）。
 */

import { log } from '@/platform/telemetry/logger'
import { createAgent, listAgents } from '@/platform/db/queries/agents'
import { listProfiles } from '@/platform/db/queries/profiles'
import type { GameType } from '@/platform/core/types'
import {
  defaultModeratorSeedSpec,
  pickSeedProfile,
  requiresModeratorSeed,
  shouldSeedModerator,
} from './moderator-seed'

export type EnsureModeratorResult = {
  /** 供对局使用的主持人 Agent id；无法提供时为 null（保持原有校验失败路径）。 */
  agentId: string | null
  /** 本次调用是否真的创建了种子 Agent（复用已有主持人时为 false）。 */
  seeded: boolean
  /** 未创建种子的原因；当前仅 'no-profile'（库中没有任何 LLM Profile）。 */
  reason?: 'no-profile'
}

export type EnsureModeratorInput = {
  gameType: GameType
  moderatorAgentId: string | null
}

let inFlightSeed: Promise<EnsureModeratorResult> | null = null

export async function ensureWerewolfModerator(
  input: EnsureModeratorInput,
): Promise<EnsureModeratorResult> {
  if (!requiresModeratorSeed(input.gameType, input.moderatorAgentId)) {
    return { agentId: input.moderatorAgentId, seeded: false }
  }

  if (!inFlightSeed) {
    inFlightSeed = seedOnce().finally(() => {
      inFlightSeed = null
    })
  }
  return inFlightSeed
}

async function seedOnce(): Promise<EnsureModeratorResult> {
  const existing = await listAgents({ gameType: 'werewolf', kind: 'moderator' })
  if (!shouldSeedModerator(existing)) {
    return { agentId: existing[0].id, seeded: false }
  }

  const profile = pickSeedProfile(await listProfiles())
  if (!profile) {
    return { agentId: null, seeded: false, reason: 'no-profile' }
  }

  const row = await createAgent({
    ...defaultModeratorSeedSpec(),
    profileId: profile.id,
  })
  log.info('system moderator seeded', {
    agentId: row.id,
    profileId: profile.id,
    displayName: row.displayName,
  })
  return { agentId: row.id, seeded: true }
}
