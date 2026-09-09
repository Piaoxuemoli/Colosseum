// 狼人杀主持人旁白触发判定（src/games/werewolf/integration/narration.ts）：
// 用 engine2 真实事件批验证——触发点边界（死讯公告 / 平安夜 / 放逐 / 终局）、
// 「仅公开信息」digest 的结构性约束（受限事件永不出现在 digest）、纯函数性。

import { describe, expect, it } from 'vitest'
import { werewolfNarrationTrigger } from '@/games/werewolf/integration/narration'
import { applyDefaultAction } from '@/games/werewolf/engine2'
import type { WerewolfEvent } from '@/games/werewolf/engine2'
import type { V2Event } from '@/platform/engine/contracts-v2'
import { toV2Event } from './_helpers'
import {
  SEATING_6,
  killVote,
  speakAll,
  settleLastWords,
  start6,
  step,
  witchPoisonPass,
  witchSavePass,
  type Acc,
} from '../engine2/_helpers'

/** 走完夜 1（刀 p3）直到天亮公告批返回；acc 停在公告后的遗言阶段。 */
function night1WithDeath(): { acc: Acc; announceBatch: V2Event[]; nightBatch: V2Event[] } {
  const acc = start6(SEATING_6)
  const wolves = acc.state.players
    .filter((p) => p.alive && p.role === 'werewolf')
    .map((p) => p.playerId)
  if (wolves.length === 0) throw new Error('no living wolf')
  // 首狼刀口投票批（wolves 受众）留作「不触发」样本；其余狼票推进阶段。
  const nightBatch = step(acc, { type: 'kill', actorId: wolves[0], targetId: 'p3' })
  for (const wolf of wolves.slice(1)) {
    step(acc, { type: 'kill', actorId: wolf, targetId: 'p3' })
  }
  witchSavePass(acc)
  witchPoisonPass(acc)
  const rawBatch = seerCheckStep(acc, 'p1')
  return { acc, announceBatch: rawBatch.map(toV2Event), nightBatch: nightBatch.map(toV2Event) }
}

function seerCheckStep(acc: Acc, target: string): WerewolfEvent[] {
  const seer = acc.state.players.find((p) => p.alive && p.role === 'seer')
  if (!seer) throw new Error('no living seer')
  return step(acc, { type: 'seerCheck', actorId: seer.playerId, targetId: target })
}

describe('werewolfNarrationTrigger — 触发点边界', () => {
  it('夜间私密批（狼刀投票，wolves 受众）不触发', () => {
    const { acc, nightBatch } = night1WithDeath()
    expect(werewolfNarrationTrigger(acc.state, nightBatch)).toBeNull()
  })

  it('天亮死讯公告批触发（focusKinds=deathsAnnounced）', () => {
    const { acc, announceBatch } = night1WithDeath()
    const trigger = werewolfNarrationTrigger(acc.state, announceBatch)
    expect(trigger).not.toBeNull()
    expect(trigger?.focusKinds).toEqual(['deathsAnnounced'])
    const digest = trigger?.publicDigest.join('\n') ?? ''
    // p3 = 3 号位夜死 → 公告行含座位号，不含身份（roleRevealedOnDeath 默认关）
    expect(digest).toContain('3 号位')
    expect(digest).not.toContain('预言家')
    expect(digest).toContain('出局')
  })

  it('平安夜公告批触发（digest 含平安夜）', () => {
    const acc = start6(SEATING_6)
    killVote(acc, null) // 空刀
    witchSavePass(acc)
    witchPoisonPass(acc)
    const rawBatch = seerCheckStep(acc, 'p1')
    const trigger = werewolfNarrationTrigger(acc.state, rawBatch.map(toV2Event))
    expect(trigger).not.toBeNull()
    expect(trigger?.focusKinds).toEqual(['deathsAnnounced'])
    expect(trigger?.publicDigest.join('\n')).toContain('平安夜')
  })

  it('放逐计票批触发（voteResult outcome=exile）', () => {
    const { acc } = night1WithDeath()
    settleLastWords(acc, '我是真预言家')
    speakAll(acc, '我是好人')
    // 5 张存活票：p1/p2/p4 投 p5（3 票）→ p5 被放逐；最后一票的批携带 voteResult。
    for (const [voter, target] of [
      ['p1', 'p5'],
      ['p2', 'p5'],
      ['p4', 'p5'],
      ['p5', 'p6'],
    ] as const) {
      step(acc, { type: 'vote', actorId: voter, targetId: target })
    }
    const batch = step(acc, { type: 'vote', actorId: 'p6', targetId: 'p4' })
    expect(batch.some((event) => event.kind === 'voteResult')).toBe(true)
    const trigger = werewolfNarrationTrigger(acc.state, batch.map(toV2Event))
    expect(trigger).not.toBeNull()
    expect(trigger?.focusKinds).toContain('voteResult')
    expect(trigger?.publicDigest.join('\n')).toContain('放逐')
  })

  it('非放逐计票（平票进 PK / 无人出局）不触发', () => {
    const { acc } = night1WithDeath()
    settleLastWords(acc, '遗言')
    speakAll(acc, '我是好人')
    // 2-2 平票 + 1 弃票 → tie-pk。
    for (const [voter, target] of [
      ['p1', 'p2'],
      ['p2', 'p1'],
      ['p4', 'p2'],
      ['p5', 'p1'],
    ] as const) {
      step(acc, { type: 'vote', actorId: voter, targetId: target })
    }
    const batch = step(acc, { type: 'vote', actorId: 'p6', targetId: null })
    const hasVoteResult = batch.some((event) => event.kind === 'voteResult')
    expect(hasVoteResult).toBe(true)
    expect(werewolfNarrationTrigger(acc.state, batch.map(toV2Event))).toBeNull()
  })

  it('终局揭示批触发；同批死亡+终局合并 focusKinds', () => {
    const { acc } = night1WithDeath()
    settleLastWords(acc, '遗言')
    speakAll(acc, '我是好人')
    for (const [voter, target] of [
      ['p1', 'p5'],
      ['p2', 'p5'],
      ['p4', 'p5'],
      ['p5', 'p6'],
    ] as const) {
      step(acc, { type: 'vote', actorId: voter, targetId: target })
    }
    let endedBatch: WerewolfEvent[] | null = null
    const capture = (batch: readonly WerewolfEvent[]): void => {
      if (batch.some((event) => event.kind === 'gameEnded')) endedBatch = [...batch]
    }
    // 最后一票放逐 p5（3 票）→ 遗言 → 2:2 parity 终局；含 gameEnded 的批
    // 可能在放逐票或后续默认推进（遗言）中出现，两条路径都捕获。
    capture(step(acc, { type: 'vote', actorId: 'p6', targetId: 'p4' }))
    let guard = 0
    while (acc.state.phase !== 'ended' && guard++ < 300) {
      const outcome = applyDefaultAction(acc.state)
      if (outcome.status !== 'accepted') throw new Error(`default rejected: ${outcome.rejection.message}`)
      acc.state = outcome.state
      acc.events.push(...outcome.events)
      capture(outcome.events)
    }
    expect(acc.state.phase).toBe('ended')

    const endedV2 = (endedBatch ?? []).map(toV2Event)
    expect(endedV2.length).toBeGreaterThan(0)
    const trigger = werewolfNarrationTrigger(acc.state, endedV2)
    expect(trigger).not.toBeNull()
    expect(trigger?.focusKinds).toContain('gameEnded')
    expect(trigger?.publicDigest.join('\n')).toContain('终局')
  })
})

describe('werewolfNarrationTrigger — 仅公开信息约束（结构性强制）', () => {
  it('context 与批中的受限事件（狼队 / 主持人 / 角色私密）绝不进入 digest', () => {
    const { acc, announceBatch } = night1WithDeath()
    // context = 公告之前的全部事件：含 wolfKillAgreed（wolves）、nightSettled
    // （moderator）、seerChecked（role-self）等私密载荷 + 公开发言/发言待补。
    const context = acc.events.map((event) => ({ ...event }))

    const trigger = werewolfNarrationTrigger(acc.state, announceBatch, context)
    expect(trigger).not.toBeNull()
    const digest = trigger?.publicDigest.join('\n') ?? ''

    // 公开事实在场：开局、阶段、公告座位。
    expect(digest).toContain('入座')
    expect(digest).toContain('3 号位')
    // 私密事实缺席：狼刀目标词法、夜间结算死因、查验结果都不应出现。
    expect(digest).not.toContain('刀')
    expect(digest).not.toContain('夜间结算')
    expect(digest).not.toContain('查验')
    expect(digest).not.toContain('狼队')
  })

  it('digest 逐行可溯源：行数不超过输入中的公开事件数', () => {
    const { acc, announceBatch } = night1WithDeath()
    const context = acc.events.map((event) => ({ ...event }))
    const trigger = werewolfNarrationTrigger(acc.state, announceBatch, context)
    expect(trigger).not.toBeNull()

    const publicEventCount = [...context, ...announceBatch.map((event) => event.raw)].filter(
      (event) => (event as { audience?: { kind?: string } }).audience?.kind === 'public',
    ).length
    // 渲染器逐事件产出至多一行（未知公开 kind 产出 0 行）——digest 行数 ≤ 公开事件数。
    expect(trigger?.publicDigest.length ?? 0).toBeLessThanOrEqual(publicEventCount)
    expect(trigger?.publicDigest.every((line) => line.length > 0)).toBe(true)
  })

  it('上下文窗口截断：digest 行数有上限（长局防 prompt 膨胀）', () => {
    const { acc, announceBatch } = night1WithDeath()
    // 造 30 条公开发言 + 1 条公告批。
    const filler = Array.from({ length: 30 }, (_, i) => ({
      kind: 'speech',
      day: 1,
      audience: { kind: 'public' },
      actorId: 'p1',
      payload: { playerId: 'p1', content: `第${i}句公开发言`, order: i + 1 },
    }))
    const trigger = werewolfNarrationTrigger(acc.state, announceBatch, filler)
    expect(trigger).not.toBeNull()
    expect((trigger?.publicDigest.length ?? 0)).toBeLessThanOrEqual(20)
    // 最近上下文保留：最后一句话在窗口内。
    expect(trigger?.publicDigest.join('\n')).toContain('第29句公开发言')
  })
})

describe('werewolfNarrationTrigger — 纯函数性', () => {
  it('同输入两次调用结果一致（deep equal），且不修改输入', () => {
    const { acc, announceBatch } = night1WithDeath()
    const context = acc.events.map((event) => ({ ...event }))
    const batchSnapshot = JSON.stringify(announceBatch)
    const contextSnapshot = JSON.stringify(context)

    const first = werewolfNarrationTrigger(acc.state, announceBatch, context)
    const second = werewolfNarrationTrigger(acc.state, announceBatch, context)
    expect(first).toEqual(second)
    expect(JSON.stringify(announceBatch)).toBe(batchSnapshot)
    expect(JSON.stringify(context)).toBe(contextSnapshot)
  })
})
