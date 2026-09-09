// 信息可见性（AVR-2xx）：三视角同源过滤（public-only / 单玩家 / god）；
// 越权零泄露对抗断言（AVR-N2 / AVR-204）：好人视角无合议副本 / 他人抉择 /
// 他人发牌情报；种子在终局前对选手不可见；表决公开记名后 voteCast 属公共。

import { describe, expect, it } from 'vitest'
import { visibleEvents } from '@/games/avalon/engine2'
import type { AvalonEvent } from '@/games/avalon/engine2'
import {
  IDS6,
  SEATING_6_LONE,
  boardOf,
  consultAll,
  runApprovedQuest,
  scriptedAssassinationHit,
  scriptedAvalonMatch,
  scriptedGoodWin,
  start5,
  startBoard,
} from './_helpers'

describe('avalon engine2 — 三视角过滤（AVR-205）', () => {
  it('公开视角：只有 public 事件（含公开记名 voteCast 与发言）', () => {
    const acc = scriptedAvalonMatch()
    const publicKinds = new Set(visibleEvents(acc.events, { type: 'public-only' }).map((e) => e.kind))
    for (const secret of [
      'rolesAssigned',
      'knowledgeRevealed',
      'questChoice',
      'evilConsulted',
      'randomnessSeed',
      'gameEnded',
    ]) {
      expect(publicKinds, `public-only 不得包含 ${secret}`).not.toContain(secret)
    }
    for (const open of [
      'matchStarted',
      'phaseEntered',
      'leaderAssigned',
      'statementIssued',
      'teamProposed',
      'voteCast',
      'voteResult',
      'questResult',
    ]) {
      expect(publicKinds, `public-only 应包含 ${open}`).toContain(open)
    }
  })

  it('上帝视角 = 全量（含受限事件）', () => {
    const acc = scriptedAvalonMatch()
    expect(visibleEvents(acc.events, { type: 'god' })).toHaveLength(acc.events.length)
  })

  it('单玩家视角：role-self 只见本人（发牌 / 情报 / 抉择 ×2 轮上车）', () => {
    const acc = scriptedAvalonMatch()
    const merlinView = visibleEvents(acc.events, { type: 'player', playerId: 'p1' })
    const secrets = merlinView.filter((e) => e.audience.kind === 'role-self')
    expect(secrets.every((e) => e.audience.kind === 'role-self' && e.audience.playerId === 'p1')).toBe(true)
    expect(secrets.map((e) => e.kind).sort()).toEqual(['knowledgeRevealed', 'questChoice', 'questChoice', 'rolesAssigned'])
  })
})

describe('avalon engine2 — 越权零泄露（AVR-204 / AVR-N2）', () => {
  /** 对抗断言：任意玩家视角绝不含「受众指向他人」的事件。 */
  function assertNoLeak(events: readonly AvalonEvent[], playerId: string): void {
    for (const event of events) {
      if (event.audience.kind === 'role-self') {
        expect(
          event.audience.playerId,
          `${playerId} 视角泄露了发给 ${event.audience.playerId} 的 ${event.kind}（seq ${event.seq}）`,
        ).toBe(playerId)
      }
      if (event.kind === 'randomnessSeed') {
        // 种子是 delayed-public：只有 gameEnded 已在流中（终局）才可见
        expect(
          events.some((e) => e.kind === 'gameEnded'),
          `${playerId} 视角在终局前看到了 randomnessSeed`,
        ).toBe(true)
      }
    }
  }

  it('刺杀局全员视角逐一对抗：无越权事件、好人不命中任何合议副本', () => {
    const acc = scriptedAssassinationHit() // 好人 3 胜 → 合议 → 刺中梅林
    for (const player of acc.state.players) {
      const view = visibleEvents(acc.events, { type: 'player', playerId: player.playerId })
      assertNoLeak(view, player.playerId)
      if (player.role === 'merlin' || player.role === 'percival' || player.role === 'loyalServant') {
        // 好人视角零合议内容（AVR-502 #8：好人不可见）
        expect(view.filter((e) => e.kind === 'evilConsulted')).toHaveLength(0)
        // 好人无 evil 情报
        const ownKnowledge = view.filter(
          (e): e is Extract<AvalonEvent, { kind: 'knowledgeRevealed' }> =>
            e.kind === 'knowledgeRevealed' && e.actorId === player.playerId,
        )
        if (player.role === 'loyalServant') expect(ownKnowledge).toHaveLength(0)
        else expect(ownKnowledge.every((e) => e.payload.insight !== 'evil')).toBe(true)
      } else {
        // 坏人视角：每名发言人各一条发给自己 role-self 的副本（2 发言人 = 2 条）
        expect(view.filter((e) => e.kind === 'evilConsulted')).toHaveLength(2)
      }
    }
  })

  it('任务抉择保密（AVR-108）：成员只见本人抉择；结果不含出牌人', () => {
    const acc = start5()
    runApprovedQuest(acc, ['p4', 'p5'], [false, false]) // 双坏队全失败
    const minionView = visibleEvents(acc.events, { type: 'player', playerId: 'p5' })
    const choices = minionView.filter((e) => e.kind === 'questChoice')
    expect(choices.map((e) => e.payload.playerId)).toEqual(['p5'])
    // 他人抉择不在视野
    const servantView = visibleEvents(acc.events, { type: 'player', playerId: 'p3' })
    expect(servantView.filter((e) => e.kind === 'questChoice')).toHaveLength(0)
    // 结果事件不含出牌人
    const result = minionView.find((e) => e.kind === 'questResult')
    expect(JSON.stringify(result?.payload)).not.toContain('p4')
    expect(JSON.stringify(result?.payload)).not.toContain('p5')
  })

  it('合议副本逐坏人发放（lone-king-6：刺客与奥伯伦互见每条合议）', () => {
    const acc = startBoard(boardOf('lone-king-6'), SEATING_6_LONE, IDS6)
    runApprovedQuest(acc, ['p1', 'p2'], true)
    runApprovedQuest(acc, ['p1', 'p2', 'p3'], true)
    runApprovedQuest(acc, ['p1', 'p2', 'p3', 'p4'], true) // 轮 3（4 人队）→ 3 成功 → 合议
    consultAll(acc)
    expect(acc.state.phase).toBe('assassination')

    // 每名坏人各持有 2 名发言人 × 1 副本 = 2 条 evilConsulted
    for (const evilId of ['p5', 'p6']) {
      const view = visibleEvents(acc.events, { type: 'player', playerId: evilId })
      const copies = view.filter((e) => e.kind === 'evilConsulted')
      expect(copies.map((e) => e.payload.speakerId).sort()).toEqual(['p5', 'p6'])
      expect(copies.every((e) => e.audience.kind === 'role-self' && e.audience.playerId === evilId)).toBe(true)
    }
    // 好人零副本
    for (const goodId of ['p1', 'p2', 'p3', 'p4']) {
      expect(
        visibleEvents(acc.events, { type: 'player', playerId: goodId }).filter((e) => e.kind === 'evilConsulted'),
      ).toHaveLength(0)
    }
    // 上帝视角全量副本 = 2 发言人 × 2 副本
    expect(visibleEvents(acc.events, { type: 'god' }).filter((e) => e.kind === 'evilConsulted')).toHaveLength(4)
  })

  it('终局后 delayed-public 解锁：选手可见种子与全员揭示', () => {
    const ongoing = start5()
    runApprovedQuest(ongoing, ['p1', 'p2'], true)
    expect(
      visibleEvents(ongoing.events, { type: 'player', playerId: 'p3' }).some((e) => e.kind === 'randomnessSeed'),
    ).toBe(false)

    const ended = scriptedGoodWin()
    expect(ended.state.phase).toBe('ended')
    const view = visibleEvents(ended.events, { type: 'player', playerId: 'p3' })
    expect(view.some((e) => e.kind === 'randomnessSeed')).toBe(true)
    const reveal = view.find((e) => e.kind === 'gameEnded')
    expect(reveal?.payload.reveal).toHaveLength(5)
  })
})
