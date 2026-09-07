import { describe, expect, it } from 'vitest'
import {
  pokerActionSchema,
  pokerPhaseSchema,
  pokerPlayerStatusSchema,
} from '@/games/poker/engine/poker-types'

describe('poker/engine/poker-types pokerPhaseSchema', () => {
  it('接受全部 7 个合法阶段', () => {
    const phases = ['waiting', 'preflop', 'flop', 'turn', 'river', 'showdown', 'handComplete']

    for (const phase of phases) {
      expect(pokerPhaseSchema.safeParse(phase).success).toBe(true)
    }
  })

  it('拒绝未知阶段', () => {
    expect(pokerPhaseSchema.safeParse('rivered').success).toBe(false)
    expect(pokerPhaseSchema.safeParse('').success).toBe(false)
  })
})

describe('poker/engine/poker-types pokerPlayerStatusSchema', () => {
  it('接受全部 5 个合法状态', () => {
    const statuses = ['active', 'folded', 'allIn', 'eliminated', 'sittingOut']

    for (const status of statuses) {
      expect(pokerPlayerStatusSchema.safeParse(status).success).toBe(true)
    }
  })

  it('拒绝未知状态', () => {
    expect(pokerPlayerStatusSchema.safeParse('busted').success).toBe(false)
  })
})

describe('poker/engine/poker-types pokerActionSchema', () => {
  it('接受 8 种动作变体', () => {
    const actions = [
      { type: 'fold' },
      { type: 'check' },
      { type: 'call', amount: 20 },
      { type: 'bet', amount: 10 },
      { type: 'raise', toAmount: 30 },
      { type: 'allIn', amount: 199 },
      { type: 'postSmallBlind', amount: 2 },
      { type: 'postBigBlind', amount: 4 },
    ]

    for (const action of actions) {
      const result = pokerActionSchema.safeParse(action)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.type).toBe(action.type)
      }
    }
  })

  it('call 允许 amount 为 0（nonnegative）但拒绝负数', () => {
    expect(pokerActionSchema.safeParse({ type: 'call', amount: 0 }).success).toBe(true)
    expect(pokerActionSchema.safeParse({ type: 'call', amount: -1 }).success).toBe(false)
  })

  it('bet/raise/allIn/blind 要求正数金额', () => {
    expect(pokerActionSchema.safeParse({ type: 'bet', amount: 0 }).success).toBe(false)
    expect(pokerActionSchema.safeParse({ type: 'bet', amount: -5 }).success).toBe(false)
    expect(pokerActionSchema.safeParse({ type: 'allIn', amount: 0 }).success).toBe(false)
    expect(pokerActionSchema.safeParse({ type: 'postSmallBlind', amount: 0 }).success).toBe(false)
    expect(pokerActionSchema.safeParse({ type: 'postBigBlind', amount: -2 }).success).toBe(false)
  })

  it('bet 混用 raise 字段会被拒绝（discriminatedUnion 形状校验）', () => {
    expect(pokerActionSchema.safeParse({ type: 'bet', toAmount: 30 }).success).toBe(false)
    expect(pokerActionSchema.safeParse({ type: 'raise', amount: 30 }).success).toBe(false)
  })

  it('raise 缺少 toAmount 被拒绝', () => {
    expect(pokerActionSchema.safeParse({ type: 'raise' }).success).toBe(false)
  })

  it('未知动作类型被拒绝', () => {
    expect(pokerActionSchema.safeParse({ type: 'bogus' }).success).toBe(false)
    expect(pokerActionSchema.safeParse({}).success).toBe(false)
  })
})
