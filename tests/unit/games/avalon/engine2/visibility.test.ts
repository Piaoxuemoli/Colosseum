// 秘密性（受众模型贯通）：公开流不含任何夜间信息与任务个人选择；
// role-self 事件只对本人可见；delayed-public（种子/终局揭示）在终局后解锁。

import { describe, expect, it } from 'vitest'
import { visibleEvents } from '@/games/avalon/engine2'
import { propose, questAll, runDefaults, start5, voteAll } from './_helpers'

describe('avalon engine2 — 受众可见性', () => {
  it('公开视角不含发牌/情报/个人表决/任务抉择/种子', () => {
    const acc = start5()
    propose(acc, ['p1', 'p2'])
    voteAll(acc, true)
    questAll(acc, true)
    runDefaults(acc, (a) => a.state.phase === 'ended')

    const publicKinds = new Set(visibleEvents(acc.events, { type: 'public-only' }).map((event) => event.kind))
    for (const secret of ['rolesAssigned', 'knowledgeRevealed', 'voteCast', 'questChoice', 'randomnessSeed']) {
      expect(publicKinds, `public-only 不得包含 ${secret}`).not.toContain(secret)
    }
    for (const open of ['matchStarted', 'phaseEntered', 'leaderAssigned', 'teamProposed', 'voteResult', 'questResult']) {
      expect(publicKinds, `public-only 应包含 ${open}`).toContain(open)
    }
  })

  it('玩家视角：自己的 role-self 可见，他人的不可见', () => {
    const acc = start5()
    const merlinView = visibleEvents(acc.events, { type: 'player', playerId: 'p1' })
    const servantView = visibleEvents(acc.events, { type: 'player', playerId: 'p3' })
    const minionView = visibleEvents(acc.events, { type: 'player', playerId: 'p5' })

    const secretsOf = (events: typeof merlinView) =>
      events.filter((event) => event.audience.kind === 'role-self')

    // 梅林：自己的发牌 + 情报（看见爪牙）；看不到他人发牌/情报
    const merlinSecrets = secretsOf(merlinView)
    expect(merlinSecrets.every((event) => event.audience.kind === 'role-self' && event.audience.playerId === 'p1')).toBe(true)
    expect(merlinSecrets.map((event) => event.kind).sort()).toEqual(['knowledgeRevealed', 'rolesAssigned'])
    // 忠诚仆人：只有发牌，无情报
    const servantSecrets = secretsOf(servantView)
    expect(servantSecrets.map((event) => event.kind)).toEqual(['rolesAssigned'])
    // 爪牙：发牌 + 互识情报
    const minionSecrets = secretsOf(minionView)
    expect(minionSecrets.map((event) => event.kind).sort()).toEqual(['knowledgeRevealed', 'rolesAssigned'])
  })

  it('任务个人选择仅本人可见（裁判=上帝视角全量）', () => {
    const acc = start5()
    propose(acc, ['p4', 'p5'])
    voteAll(acc, true)
    questAll(acc, [true, false])

    const mordredView = visibleEvents(acc.events, { type: 'player', playerId: 'p4' })
    const minionView = visibleEvents(acc.events, { type: 'player', playerId: 'p5' })
    expect(mordredView.filter((event) => event.kind === 'questChoice').map((event) => event.actorId)).toEqual(['p4'])
    expect(minionView.filter((event) => event.kind === 'questChoice').map((event) => event.actorId)).toEqual(['p5'])
    expect(visibleEvents(acc.events, { type: 'god' }).filter((event) => event.kind === 'questChoice')).toHaveLength(2)
  })

  it('终局后 delayed-public 解锁：选手视角可见种子与全员揭示', () => {
    const acc = start5()
    // 未终局：选手看不到种子
    expect(visibleEvents(acc.events, { type: 'player', playerId: 'p1' }).some((event) => event.kind === 'randomnessSeed')).toBe(false)

    propose(acc, ['p1', 'p2'])
    voteAll(acc, true)
    questAll(acc, true)
    propose(acc, ['p1', 'p2'])
    voteAll(acc, true)
    questAll(acc, true)
    expect(acc.state.phase).toBe('ended')

    const view = visibleEvents(acc.events, { type: 'player', playerId: 'p3' })
    expect(view.some((event) => event.kind === 'randomnessSeed')).toBe(true)
    const reveal = view.find((event) => event.kind === 'gameEnded')
    expect(reveal?.payload.reveal).toHaveLength(5)
  })
})
