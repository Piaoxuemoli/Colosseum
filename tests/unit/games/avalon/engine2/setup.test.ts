// 发牌受众正确性（R3-2 冒烟规则第一段）：
// 梅林看到爪牙（看不到莫德雷德）；派西维尔看到梅林（无莫甘娜混淆）；
// 坏人互识（含莫德雷德）；忠诚仆人无情报。种子化发牌入事件流（确定性）。

import { describe, expect, it } from 'vitest'
import { createMatch, createMatchFromSeating } from '@/games/avalon/engine2'
import { IDS5, SEATING_5, SEED, evsOf, start5 } from './_helpers'

describe('avalon engine2 — setup（发牌与夜间情报受众）', () => {
  it('开局即进入轮 1 提名阶段，队长 = 座位 1', () => {
    const acc = start5()
    expect(acc.state.round).toBe(1)
    expect(acc.state.phase).toBe('proposal')
    expect(acc.state.pendingActor).toBe('p1')
    expect(acc.state.players.map((player) => player.seat)).toEqual([1, 2, 3, 4, 5])
  })

  it('发牌：每人一条 role-self 事件，角色与落座一致', () => {
    const acc = start5()
    const dealt = evsOf(acc.events, 'rolesAssigned')
    expect(dealt).toHaveLength(5)
    const dealtByActor = new Map(dealt.map((event) => [event.actorId ?? '', event]))
    for (const playerId of IDS5) {
      const event = dealtByActor.get(playerId)
      expect(event, `missing rolesAssigned for ${playerId}`).toBeDefined()
      expect(event?.audience).toEqual({ kind: 'role-self', playerId })
      expect(event?.payload.role).toBe(SEATING_5[Number(playerId.slice(1)) - 1])
    }
  })

  it('梅林只看到普通坏人（爪牙），看不到莫德雷德', () => {
    const acc = start5()
    const merlin = evsOf(acc.events, 'knowledgeRevealed').find((event) => event.actorId === 'p1')
    expect(merlin).toBeDefined()
    expect(merlin?.audience).toEqual({ kind: 'role-self', playerId: 'p1' })
    expect(merlin?.payload.insight).toBe('merlin')
    expect(merlin?.payload.playerIds).toEqual(['p5'])
  })

  it('派西维尔看到梅林（简化：无莫甘娜混淆）', () => {
    const acc = start5()
    const percival = evsOf(acc.events, 'knowledgeRevealed').find((event) => event.actorId === 'p2')
    expect(percival?.payload).toEqual({ insight: 'percival', playerIds: ['p1'] })
    expect(percival?.audience).toEqual({ kind: 'role-self', playerId: 'p2' })
  })

  it('坏人互识（含莫德雷德）：爪牙与莫德雷德互相指认', () => {
    const acc = start5()
    const knowledge = evsOf(acc.events, 'knowledgeRevealed')
    const mordred = knowledge.find((event) => event.actorId === 'p4')
    const minion = knowledge.find((event) => event.actorId === 'p5')
    expect(mordred?.payload).toEqual({ insight: 'evil', playerIds: ['p5'] })
    expect(minion?.payload).toEqual({ insight: 'evil', playerIds: ['p4'] })
    // 忠诚仆人（p3）没有任何情报事件
    expect(knowledge.find((event) => event.actorId === 'p3')).toBeUndefined()
    expect(knowledge).toHaveLength(4)
  })

  it('开局名册公共、随机种子延迟公开（不得向选手泄露发牌）', () => {
    const acc = start5()
    const started = evsOf(acc.events, 'matchStarted')[0]
    expect(started.audience).toEqual({ kind: 'public' })
    expect(started.payload.seats.map((seat) => seat.playerId)).toEqual([...IDS5])
    const seed = evsOf(acc.events, 'randomnessSeed')[0]
    expect(seed.audience).toEqual({ kind: 'delayed-public' })
    expect(seed.payload.seed).toBe(SEED)
  })

  it('洗牌入口确定性：同种子同事件流，角色多重集恒等于固定板', () => {
    const a = createMatch({ playerIds: [...IDS5], seed: 42 })
    const b = createMatch({ playerIds: [...IDS5], seed: 42 })
    expect(a.status).toBe('created')
    if (a.status !== 'created' || b.status !== 'created') return
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events))
    const roles = a.state.players.map((player) => player.role).sort()
    expect(roles).toEqual([...SEATING_5].sort())
    // 不同种子产生（至少这一对）不同发牌
    const c = createMatch({ playerIds: [...IDS5], seed: 7 })
    if (c.status !== 'created') throw new Error('seed 7 rejected')
    expect(c.state.players.map((player) => player.role)).not.toEqual(a.state.players.map((player) => player.role))
  })

  it('非法入参结构化拒绝：人数不符 / 重复 id / 落座与板子不符', () => {
    const badCount = createMatch({ playerIds: ['p1', 'p2', 'p3'], seed: 1 })
    expect(badCount.status).toBe('invalid')

    const dup = createMatch({ playerIds: ['p1', 'p1', 'p3', 'p4', 'p5'], seed: 1 })
    expect(dup.status).toBe('invalid')

    const badSeating = createMatchFromSeating({
      seating: ['merlin', 'percival', 'loyalServant', 'loyalServant', 'minion'],
      playerIds: [...IDS5],
      seed: 1,
    })
    expect(badSeating.status).toBe('invalid')
  })
})
