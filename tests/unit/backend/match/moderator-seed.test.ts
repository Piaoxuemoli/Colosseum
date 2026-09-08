import { describe, expect, it } from 'vitest'
import {
  SYSTEM_MODERATOR_AVATAR_EMOJI,
  SYSTEM_MODERATOR_DISPLAY_NAME,
  SYSTEM_MODERATOR_PRESET_ID,
  defaultModeratorSeedSpec,
  pickSeedProfile,
  requiresModeratorSeed,
  shouldSeedModerator,
} from '@/backend/match/moderator-seed'
import {
  WEREWOLF_MODERATOR_PRESETS,
  type PromptPreset,
} from '@/backend/agent/prompt-presets'

describe('requiresModeratorSeed（种子上下文判定）', () => {
  it('狼人杀 + 未指定主持人 → 需要种子', () => {
    expect(requiresModeratorSeed('werewolf', null)).toBe(true)
  })

  it('调用方已指定 moderatorAgentId → 不需要种子（不越权替换用户选择）', () => {
    expect(requiresModeratorSeed('werewolf', 'agent_123')).toBe(false)
  })

  it('非狼人杀（德扑）→ 不需要种子', () => {
    expect(requiresModeratorSeed('poker', null)).toBe(false)
    expect(requiresModeratorSeed('poker', 'agent_123')).toBe(false)
  })
})

describe('shouldSeedModerator（幂等闸门）', () => {
  it('库中没有任何主持人 → 需要播种', () => {
    expect(shouldSeedModerator([])).toBe(true)
  })

  it('已存在一个主持人（自建或历史种子）→ 不再创建第二个', () => {
    expect(shouldSeedModerator([{ id: 'agent_mod' }])).toBe(false)
  })

  it('存在多个主持人 → 同样不播种', () => {
    expect(shouldSeedModerator([{ id: 'a' }, { id: 'b' }])).toBe(false)
  })
})

describe('defaultModeratorSeedSpec（默认种子规格）', () => {
  it('产出可直接落库的 werewolf 主持人规格，prompt 来自预置模板', () => {
    const spec = defaultModeratorSeedSpec()
    expect(spec.displayName).toBe(SYSTEM_MODERATOR_DISPLAY_NAME)
    expect(spec.gameType).toBe('werewolf')
    expect(spec.kind).toBe('moderator')
    expect(spec.avatarEmoji).toBe(SYSTEM_MODERATOR_AVATAR_EMOJI)

    const preset = WEREWOLF_MODERATOR_PRESETS.find((p) => p.id === SYSTEM_MODERATOR_PRESET_ID)
    expect(preset).toBeDefined()
    expect(spec.systemPrompt).toBe(preset?.prompt)
    expect(spec.systemPrompt.length).toBeGreaterThan(0)
  })

  it('指定 preset 列表中找不到默认 id 时回退到第一个', () => {
    const only: PromptPreset[] = [
      {
        id: 'custom-mod',
        label: '自定义',
        description: '测试用',
        prompt: '你是测试主持人。',
      },
    ]
    expect(defaultModeratorSeedSpec(only).systemPrompt).toBe('你是测试主持人。')
  })

  it('preset 列表为空属于配置错误 → 抛错而不是写入空 prompt', () => {
    expect(() => defaultModeratorSeedSpec([])).toThrow()
  })
})

describe('pickSeedProfile（外键绑定选择）', () => {
  it('没有任何 Profile → 返回 null（放弃种子，保留原有校验失败路径）', () => {
    expect(pickSeedProfile([])).toBeNull()
  })

  it('有 Profile → 复用第一个', () => {
    const first = { id: 'profile_1' }
    const second = { id: 'profile_2' }
    expect(pickSeedProfile([first, second])).toBe(first)
  })
})
