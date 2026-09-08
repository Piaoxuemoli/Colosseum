import { describe, expect, it } from 'vitest'
import { moderatorNarrationEvent } from '@/backend/orchestrator/werewolf-hooks'
import { killPlayers, makeBaseState } from '../../games/werewolf/_helpers'

/**
 * FR-4.7-01：解说旁白可关闭，但仅解说性内容可关，流程性宣告不可关。
 * `moderatorNarrationEvent` 的事件本体承载流程性宣告（upcomingPhase /
 * day / deaths，观战 store 靠它推进日次与死亡名单），`narration` 字段承载
 * 主持人解说文本 —— kill-switch 只静音后者。
 */
describe('moderatorNarrationEvent narration gating (FR-4.7-01)', () => {
  const phaseTransition = () => {
    const prev = makeBaseState()
    const next = killPlayers(prev, ['v1'], 1, 'werewolfKill')
    return { prev, next: { ...next, phase: 'day/announce' as const, day: 1 } }
  }

  it('未传开关（默认/向后兼容）→ 解说文本正常产出', () => {
    const { prev, next } = phaseTransition()
    const event = moderatorNarrationEvent(prev, next)
    expect(event).not.toBeNull()
    expect(typeof event?.payload.narration).toBe('string')
    expect((event?.payload.narration as string).length).toBeGreaterThan(0)
  })

  it('narrationEnabled: true → 解说文本正常产出', () => {
    const { prev, next } = phaseTransition()
    const event = moderatorNarrationEvent(prev, next, { narrationEnabled: true })
    expect(typeof event?.payload.narration).toBe('string')
  })

  it('narrationEnabled: false → 解说静音为 null，流程性宣告照发', () => {
    const { prev, next } = phaseTransition()
    const event = moderatorNarrationEvent(prev, next, { narrationEnabled: false })
    expect(event).not.toBeNull()
    expect(event?.kind).toBe('werewolf/moderator-narrate')
    // 解说性旁白被静音（store 对非字符串回退 ''）
    expect(event?.payload.narration).toBeNull()
    // 流程性宣告仍在：阶段推进 + 日次 + 死亡公示
    expect(event?.payload.upcomingPhase).toBe('day/announce')
    expect(event?.payload.day).toBe(1)
    expect(event?.payload.deaths).toEqual([{ agentId: 'v1', cause: 'werewolfKill' }])
  })

  it('narrationEnabled: undefined → 显式传对象但不关 → 保持开启', () => {
    const { prev, next } = phaseTransition()
    const event = moderatorNarrationEvent(prev, next, {})
    expect(typeof event?.payload.narration).toBe('string')
  })

  it('阶段未变化 / 对局已结束 → 不产生公告事件（既有行为不受开关影响）', () => {
    const base = makeBaseState()
    expect(moderatorNarrationEvent(base, { ...base }, { narrationEnabled: false })).toBeNull()
    expect(
      moderatorNarrationEvent(base, {
        ...base,
        phase: 'day/announce',
        matchComplete: true,
      }),
    ).toBeNull()
  })
})
