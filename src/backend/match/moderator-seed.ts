/**
 * 系统主持人种子的纯逻辑决策（R2-2 / FR-4.2-02）。
 *
 * 痛点（docs/repair 审计 15）：创建狼人杀对局前必须先手工建一个
 * kind=moderator 的 Agent，否则 `validateWerewolfCreate` 直接 400。
 * 本模块提供「是否需要种子 / 种子长什么样」的纯函数；真正落库的编排
 * 在 `ensure-system-moderator.ts`（单测只覆盖这里的纯逻辑）。
 */

import {
  WEREWOLF_MODERATOR_PRESETS,
  type PromptPreset,
} from '@/backend/agent/prompt-presets'

export const SYSTEM_MODERATOR_DISPLAY_NAME = '系统主持人'
export const SYSTEM_MODERATOR_AVATAR_EMOJI = '🎙️'
/** 种子固定使用的人设模板 id（prompt-presets.ts 中的中立主持人）。 */
export const SYSTEM_MODERATOR_PRESET_ID = 'neutral-mod'

/** 是否处于「本次对局创建需要系统补一个主持人」的上下文。 */
export function requiresModeratorSeed(
  gameType: string,
  moderatorAgentId: string | null,
): boolean {
  return gameType === 'werewolf' && moderatorAgentId === null
}

/**
 * 幂等闸门：只要已存在任意一个 werewolf 主持人（用户自建或历史种子），
 * 就不再创建第二个。
 */
export function shouldSeedModerator(existingModerators: ReadonlyArray<{ id: string }>): boolean {
  return existingModerators.length === 0
}

export type ModeratorSeedSpec = {
  displayName: string
  gameType: 'werewolf'
  kind: 'moderator'
  systemPrompt: string
  avatarEmoji: string
}

/**
 * 默认主持人种子的完整规格（不含 profileId —— agents 表外键要求绑定
 * Profile，绑定哪个 Profile 由落库编排按「第一个已有 Profile」决定）。
 *
 * 允许注入 presets 便于测试；找不到指定 preset 时回退到列表第一个，
 * 列表为空属于部署期配置错误，直接抛错而不是写入空 prompt。
 */
export function defaultModeratorSeedSpec(
  presets: readonly PromptPreset[] = WEREWOLF_MODERATOR_PRESETS,
): ModeratorSeedSpec {
  const preset =
    presets.find((candidate) => candidate.id === SYSTEM_MODERATOR_PRESET_ID) ?? presets[0]
  if (!preset) {
    throw new Error('no werewolf moderator preset available for system moderator seed')
  }
  return {
    displayName: SYSTEM_MODERATOR_DISPLAY_NAME,
    gameType: 'werewolf',
    kind: 'moderator',
    systemPrompt: preset.prompt,
    avatarEmoji: SYSTEM_MODERATOR_AVATAR_EMOJI,
  }
}

/**
 * agents.profileId 非空且外键指向 api_profiles，种子必须绑定一个已有
 * Profile；一个都没有时返回 null（调用方放弃种子，保持原有的 400 校验）。
 */
export function pickSeedProfile<T extends { id: string }>(profiles: readonly T[]): T | null {
  return profiles.length > 0 ? profiles[0] : null
}
