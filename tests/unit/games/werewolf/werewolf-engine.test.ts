import { describe, it, expect } from 'vitest'
import { werewolfEngine } from '@/games/werewolf/engine/werewolf-engine'
import type { WerewolfAction, WerewolfState } from '@/games/werewolf/engine/types'
import { makeBaseState, playerOf } from './_helpers'

const agentIds = ['a', 'b', 'c', 'd', 'e', 'f']
const names = Object.fromEntries(agentIds.map((id) => [id, id.toUpperCase()]))

function init(seed = 1): WerewolfState {
  return werewolfEngine.createInitialState(
    { seed, agentNames: names, moderatorAgentId: 'mod' },
    agentIds,
  )
}

function speak(content: string): WerewolfAction {
  return { type: 'day/speak', content }
}
function vote(targetId: string | null): WerewolfAction {
  return { type: 'day/vote', targetId }
}

describe('werewolfEngine.createInitialState', () => {
  it('生成合法 6 人局初始状态', () => {
    const s = init(7)
    expect(s.players).toHaveLength(6)
    expect(s.players.map((p) => p.agentId)).toEqual(agentIds)
    expect(s.players.every((p) => p.alive)).toBe(true)
    expect(s.day).toBe(0)
    expect(s.phase).toBe('night/werewolfDiscussion')
    expect(s.matchComplete).toBe(false)
    expect(s.winner).toBe(null)
    expect(s.witchPotions).toEqual({ save: true, poison: true })
    expect(s.moderatorAgentId).toBe('mod')
    const roles = Object.values(s.roleAssignments)
    expect(roles.filter((r) => r === 'werewolf')).toHaveLength(2)
    expect(roles.filter((r) => r === 'seer')).toHaveLength(1)
    expect(roles.filter((r) => r === 'witch')).toHaveLength(1)
    expect(roles.filter((r) => r === 'villager')).toHaveLength(2)
  })

  it('初始行动者是第一头狼，第二头狼在讨论队列', () => {
    const s = init(7)
    const wolves = agentIds.filter((id) => s.roleAssignments[id] === 'werewolf')
    expect(s.currentActor).toBe(wolves[0])
    expect(s.werewolfDiscussionQueue).toEqual([wolves[1]])
  })

  it('agentNames 缺省时名字回落到 agentId', () => {
    const s = werewolfEngine.createInitialState({ seed: 1 }, agentIds)
    expect(s.players[0].name).toBe('a')
  })

  it('同 seed 完全确定', () => {
    expect(init(42).roleAssignments).toEqual(init(42).roleAssignments)
  })
})

describe('werewolfEngine.availableActions', () => {
  it('非当前行动者永远拿到空列表', () => {
    const s = init(1)
    const other = agentIds.find((id) => id !== s.currentActor)!
    expect(werewolfEngine.availableActions(s, other)).toEqual([])
  })

  it('各阶段给当前行动者返回对应动作类型', () => {
    const base = makeBaseState()
    const cases: Array<[WerewolfState['phase'], string, string[]]> = [
      ['night/werewolfDiscussion', 'w1', ['day/speak']],
      ['night/werewolfKill', 'w1', ['night/werewolfKill']],
      ['night/seerCheck', 's', ['night/seerCheck']],
      ['night/witchAction', 'wi', ['night/witchSave', 'night/witchPoison']],
      ['day/speak', 'v1', ['day/speak']],
      ['day/vote', 'v1', ['day/vote']],
    ]
    for (const [phase, actor, types] of cases) {
      const s = { ...base, phase, currentActor: actor }
      expect(werewolfEngine.availableActions(s, actor).map((a) => a.type)).toEqual(types)
    }
  })

  it('女巫救药用尽后夜间只剩 witchPoison', () => {
    const s = {
      ...makeBaseState(),
      phase: 'night/witchAction' as const,
      currentActor: 'wi',
      witchPotions: { save: false, poison: true },
    }
    expect(werewolfEngine.availableActions(s, 'wi').map((a) => a.type)).toEqual(['night/witchPoison'])
  })
})

describe('werewolfEngine.applyAction — 夜间流程', () => {
  it('非法动作直接抛错（含原因）', () => {
    const s = { ...makeBaseState(), phase: 'night/werewolfKill' as const, currentActor: 'w1' }
    expect(() =>
      werewolfEngine.applyAction(s, 's', { type: 'night/werewolfKill', targetId: 'v1', reasoning: 'x' }),
    ).toThrow(/invalid action \(not-werewolf\)/)
    const dead = { ...s, players: s.players.map((p) => (p.agentId === 'w1' ? { ...p, alive: false } : p)) }
    expect(() =>
      werewolfEngine.applyAction(dead, 'w1', { type: 'night/werewolfKill', targetId: 'v1', reasoning: 'x' }),
    ).toThrow(/actor-dead/)
  })

  it('狼人发言循环两头狼后进入 werewolfKill；事件仅狼可见', () => {
    const s0 = makeBaseState()
    const r1 = werewolfEngine.applyAction(s0, 'w1', speak('今晚刀 V1'))
    expect(r1.nextState.phase).toBe('night/werewolfDiscussion')
    expect(r1.nextState.currentActor).toBe('w2')
    expect(r1.events[0]).toMatchObject({
      kind: 'werewolf/werewolfDiscuss',
      visibility: 'role-restricted',
      restrictedTo: ['w1', 'w2'],
    })

    const r2 = werewolfEngine.applyAction(r1.nextState, 'w2', speak('同意'))
    expect(r2.nextState.phase).toBe('night/werewolfKill')
    expect(r2.nextState.currentActor).toBe('w1')
    expect(r1.nextState.speechLog).toHaveLength(1) // 夜间狼聊计入 speechLog
  })

  it('狼刀：记录 lastNightKilled 并推进到验人；事件仅狼可见', () => {
    const s = { ...makeBaseState(), phase: 'night/werewolfKill' as const, currentActor: 'w1' }
    const r = werewolfEngine.applyAction(s, 'w1', {
      type: 'night/werewolfKill',
      targetId: 'v1',
      reasoning: '像预言家',
    })
    expect(r.nextState.lastNightKilled).toBe('v1')
    expect(r.nextState.phase).toBe('night/seerCheck')
    expect(r.nextState.currentActor).toBe('s')
    expect(r.events[0]).toMatchObject({
      kind: 'werewolf/werewolfKill',
      actorAgentId: 'w1',
      visibility: 'role-restricted',
      restrictedTo: ['w1', 'w2'],
    })
  })

  it('验人：结果写入 seerCheckResults（含真实身份），事件仅预言家可见', () => {
    const s = { ...makeBaseState(), phase: 'night/seerCheck' as const, currentActor: 's' }
    const r = werewolfEngine.applyAction(s, 's', { type: 'night/seerCheck', targetId: 'w2' })
    expect(r.nextState.seerCheckResults).toEqual([{ day: 0, targetId: 'w2', role: 'werewolf' }])
    expect(r.nextState.phase).toBe('night/witchAction')
    expect(r.nextState.currentActor).toBe('wi')
    expect(r.events[0]).toMatchObject({
      kind: 'werewolf/seerCheck',
      visibility: 'role-restricted',
      restrictedTo: ['s'],
    })
    expect(r.events[0].payload).toEqual({ targetId: 'w2', role: 'werewolf' })
  })

  it('女巫救人：消耗救药、标记 lastNightSaved、天亮刀口存活', () => {
    const s = {
      ...makeBaseState(),
      phase: 'night/witchAction' as const,
      currentActor: 'wi',
      lastNightKilled: 'v1',
    }
    const r = werewolfEngine.applyAction(s, 'wi', { type: 'night/witchSave' })
    expect(r.nextState.witchPotions.save).toBe(false)
    // 黎明结算后夜间临时字段被清空
    expect(r.nextState.lastNightSaved).toBe(null)
    expect(r.nextState.lastNightKilled).toBe(null)
    expect(r.nextState.day).toBe(1)
    expect(r.nextState.phase).toBe('day/speak')
    expect(playerOf(r.nextState, 'v1').alive).toBe(true)
    expect(r.events[0].kind).toBe('werewolf/witchSave')
  })

  it('女巫毒人：消耗毒药、双死结算（刀 + 毒）', () => {
    const s = {
      ...makeBaseState(),
      phase: 'night/witchAction' as const,
      currentActor: 'wi',
      lastNightKilled: 'v1',
    }
    const r = werewolfEngine.applyAction(s, 'wi', { type: 'night/witchPoison', targetId: 'v2' })
    expect(r.nextState.witchPotions.poison).toBe(false)
    expect(playerOf(r.nextState, 'v1')).toMatchObject({ alive: false, deathCause: 'werewolfKill' })
    expect(playerOf(r.nextState, 'v2')).toMatchObject({ alive: false, deathCause: 'witchPoison' })
  })

  it('女巫空过（targetId=null）不消耗毒药', () => {
    const s = { ...makeBaseState(), phase: 'night/witchAction' as const, currentActor: 'wi' }
    const r = werewolfEngine.applyAction(s, 'wi', { type: 'night/witchPoison', targetId: null })
    expect(r.nextState.witchPotions.poison).toBe(true)
    expect(r.nextState.day).toBe(1)
  })
})

describe('werewolfEngine.applyAction — 白天流程', () => {
  function day1SpeechState(): WerewolfState {
    // 天亮：v1 已被刀，剩余 5 人按座位序发言，w1 先说
    const base = makeBaseState()
    const s = {
      ...base,
      day: 1,
      phase: 'day/speak' as const,
      currentActor: 'w1',
      speechQueue: ['w2', 's', 'wi', 'v2'],
      players: base.players.map((p) =>
        p.agentId === 'v1' ? { ...p, alive: false, deathDay: 0, deathCause: 'werewolfKill' as const } : p,
      ),
    }
    return s
  }

  it('发言按队列轮转，全员讲完进入投票；发言事件公开', () => {
    let s = day1SpeechState()
    const order = ['w1', 'w2', 's', 'wi', 'v2']
    for (let i = 0; i < order.length; i++) {
      const actor = order[i]
      expect(werewolfEngine.currentActor(s)).toBe(actor)
      const r = werewolfEngine.applyAction(s, actor, speak(`${actor} 发言`))
      expect(r.events[0]).toMatchObject({ kind: 'werewolf/speak', visibility: 'public', actorAgentId: actor })
      if (i < order.length - 1) {
        expect(r.nextState.phase).toBe('day/speak')
        expect(r.nextState.currentActor).toBe(order[i + 1])
      } else {
        expect(r.nextState.phase).toBe('day/vote')
        expect(r.nextState.currentActor).toBe('w1')
      }
      s = r.nextState
    }
    expect(s.speechLog).toHaveLength(5)
    expect(s.speechLog.map((x) => x.agentId)).toEqual(order)
    expect(s.speechLog.every((x) => x.day === 1)).toBe(true)
  })

  it('发言支持 claimedRole 并入档', () => {
    const s = day1SpeechState()
    const r = werewolfEngine.applyAction(s, 'w1', {
      type: 'day/speak',
      content: '我是预言家',
      claimedRole: 'seer',
    })
    expect(r.nextState.speechLog[0]).toMatchObject({ agentId: 'w1', claimedRole: 'seer' })
  })

  it('投票逐人轮转，最后一张票触发计票放逐', () => {
    let s: WerewolfState = { ...day1SpeechState(), phase: 'day/vote', currentActor: 'w1' }
    const ballots: Array<[string, string | null]> = [
      ['w1', 's'],
      ['w2', 's'],
      ['s', 'w1'],
      ['wi', 'w1'],
      ['v2', 'w1'],
    ]
    for (let i = 0; i < ballots.length; i++) {
      const [voter, target] = ballots[i]
      expect(s.currentActor).toBe(voter)
      const r = werewolfEngine.applyAction(s, voter, vote(target))
      expect(r.events[0]).toMatchObject({ kind: 'werewolf/vote', visibility: 'public' })
      s = r.nextState
    }
    // w1 3 票 > s 2 票 → w1 被放逐，夜晚重新开始
    expect(playerOf(s, 'w1')).toMatchObject({ alive: false, deathDay: 1, deathCause: 'vote' })
    expect(s.phase).toBe('night/werewolfDiscussion')
    expect(s.currentActor).toBe('w2')
    expect(s.werewolfDiscussionQueue).toEqual([])
    expect(s.voteLog).toHaveLength(5)
  })

  it('弃票（null）计入 voteLog 但不计票；全员弃票无人死亡', () => {
    let s: WerewolfState = { ...day1SpeechState(), phase: 'day/vote', currentActor: 'w1' }
    for (const voter of ['w1', 'w2', 's', 'wi', 'v2']) {
      s = werewolfEngine.applyAction(s, voter, vote(null)).nextState
    }
    expect(s.voteLog).toHaveLength(5)
    expect(s.players.filter((p) => p.alive)).toHaveLength(5)
    expect(s.phase).toBe('night/werewolfDiscussion')
  })
})

describe('werewolfEngine — 完整对局脚本（白天放逐两狼 → 好人胜）', () => {
  it('从初始状态打到终局，终局含角色揭示', () => {
    let s = makeBaseState()

    // ── 第 0 夜：狼聊 → 刀 v1 → 验 w2 → 女巫空过 ──
    s = werewolfEngine.applyAction(s, 'w1', speak('刀 V1')).nextState
    s = werewolfEngine.applyAction(s, 'w2', speak('ok')).nextState
    expect(s.phase).toBe('night/werewolfKill')
    s = werewolfEngine.applyAction(s, s.currentActor!, {
      type: 'night/werewolfKill',
      targetId: 'v1',
      reasoning: '首刀边位',
    }).nextState
    expect(s.phase).toBe('night/seerCheck')
    s = werewolfEngine.applyAction(s, 's', { type: 'night/seerCheck', targetId: 'w2' }).nextState
    expect(s.phase).toBe('night/witchAction')
    s = werewolfEngine.applyAction(s, 'wi', { type: 'night/witchPoison', targetId: null }).nextState

    // ── 第 1 天：v1 死，5 人发言 ──
    expect(s.day).toBe(1)
    expect(s.phase).toBe('day/speak')
    expect(playerOf(s, 'v1').alive).toBe(false)
    const day1Speakers: string[] = [s.currentActor!]
    while (s.phase === 'day/speak') {
      s = werewolfEngine.applyAction(s, s.currentActor!, speak('过')).nextState
      if (s.phase === 'day/speak' && s.currentActor) day1Speakers.push(s.currentActor)
    }
    expect(s.phase).toBe('day/vote')
    expect(day1Speakers).toEqual(['w1', 'w2', 's', 'wi', 'v2'])

    // ── 投票放逐 w1（3 vs 2）──
    for (const [voter, target] of [
      ['w1', 's'],
      ['w2', 's'],
      ['s', 'w1'],
      ['wi', 'w1'],
      ['v2', 'w1'],
    ] as const) {
      s = werewolfEngine.applyAction(s, voter, vote(target)).nextState
    }
    expect(playerOf(s, 'w1').alive).toBe(false)
    expect(s.phase).toBe('night/werewolfDiscussion')
    expect(s.currentActor).toBe('w2')
    expect(s.matchComplete).toBe(false)

    // ── 第 1 夜：独狼发言 → 刀预言家 s → s 当夜仍可验人（死于黎明）→ 女巫空过 ──
    s = werewolfEngine.applyAction(s, 'w2', speak('单狼夜')).nextState
    expect(s.phase).toBe('night/werewolfKill')
    s = werewolfEngine.applyAction(s, 'w2', {
      type: 'night/werewolfKill',
      targetId: 's',
      reasoning: '验过我一票',
    }).nextState
    // 刀口死亡在黎明才结算：seer 的 alive 仍为 true，因此照常进入验人阶段
    expect(s.phase).toBe('night/seerCheck')
    expect(s.currentActor).toBe('s')
    s = werewolfEngine.applyAction(s, 's', { type: 'night/seerCheck', targetId: 'w2' }).nextState
    expect(s.phase).toBe('night/witchAction')
    s = werewolfEngine.applyAction(s, 'wi', { type: 'night/witchPoison', targetId: null }).nextState

    // ── 第 2 天：s 死，3 人发言（w2, wi, v2）──
    expect(s.day).toBe(2)
    expect(playerOf(s, 's').alive).toBe(false)
    expect(playerOf(s, 's').deathCause).toBe('werewolfKill')
    const day2Speakers: string[] = [s.currentActor!]
    while (s.phase === 'day/speak') {
      s = werewolfEngine.applyAction(s, s.currentActor!, speak('过')).nextState
      if (s.phase === 'day/speak' && s.currentActor) day2Speakers.push(s.currentActor)
    }
    expect(day2Speakers).toEqual(['w2', 'wi', 'v2'])

    // ── 投票放逐最后一头狼 w2 → 好人胜 ──
    for (const [voter, target] of [
      ['w2', 'wi'],
      ['wi', 'w2'],
      ['v2', 'w2'],
    ] as const) {
      s = werewolfEngine.applyAction(s, voter, vote(target)).nextState
    }
    expect(s.matchComplete).toBe(true)
    expect(s.winner).toBe('villagers')
    expect(s.currentActor).toBe(null)
    expect(playerOf(s, 'w2')).toMatchObject({ alive: false, deathCause: 'vote' })

    // ── 终局：角色揭示与排名 ──
    const result = werewolfEngine.finalize(s)
    expect(result.winnerFaction).toBe('villagers')
    expect(result.ranking).toHaveLength(6)
    for (const entry of result.ranking) {
      expect(entry.extra?.role).toBe(s.roleAssignments[entry.agentId])
    }
    const aliveRanking = result.ranking.filter((e) => e.score === 1)
    expect(aliveRanking.map((e) => e.agentId).sort()).toEqual(['v2', 'wi'])
    expect(result.stats).toMatchObject({ aliveCount: 2, totalDays: 2 })
  })
})

describe('werewolfEngine — 狼人夜间刀空预言家/女巫导致跳阶段的对局', () => {
  it('预言家在白天被放逐后，下一夜 werewolfKill 直接跳到 witchAction', () => {
    // 构造：day1 已放逐 s，现在进入第 1 夜狼刀阶段
    const base = makeBaseState()
    let s: WerewolfState = {
      ...base,
      day: 1,
      phase: 'night/werewolfKill',
      currentActor: 'w1',
      players: base.players.map((p) =>
        p.agentId === 's' ? { ...p, alive: false, deathDay: 1, deathCause: 'vote' as const } : p,
      ),
    }
    s = werewolfEngine.applyAction(s, 'w1', {
      type: 'night/werewolfKill',
      targetId: 'v1',
      reasoning: 'r',
    }).nextState
    expect(s.phase).toBe('night/witchAction')
    expect(s.currentActor).toBe('wi')
  })
})

describe('werewolfEngine.boundary', () => {
  it('matchComplete 翻转 → match-end；day 变化 → round-end；其余 → null', () => {
    const prev = init(1)
    expect(werewolfEngine.boundary({ ...prev, matchComplete: false }, { ...prev, matchComplete: true })).toBe(
      'match-end',
    )
    expect(werewolfEngine.boundary({ ...prev, day: 1 }, { ...prev, day: 2 })).toBe('round-end')
    expect(werewolfEngine.boundary(prev, { ...prev, currentActor: 'x' })).toBe(null)
  })
})

describe('werewolfEngine.finalize', () => {
  it('存活者排名靠前（同组按座位序），死亡者附 deathDay/deathCause', () => {
    const base = makeBaseState()
    const s: WerewolfState = {
      ...base,
      matchComplete: true,
      winner: 'werewolves',
      players: base.players.map((p) =>
        p.agentId === 's'
          ? { ...p, alive: false, deathDay: 1, deathCause: 'vote' as const }
          : p,
      ),
    }
    const r = werewolfEngine.finalize(s)
    expect(r.winnerFaction).toBe('werewolves')
    expect(r.ranking.map((e) => e.agentId)).toEqual(['w1', 'w2', 'wi', 'v1', 'v2', 's'])
    expect(r.ranking[5].extra).toEqual({ role: 'seer', deathDay: 1, deathCause: 'vote' })
    expect(r.ranking[0].score).toBe(1)
    expect(r.ranking[5].score).toBe(0)
  })

  it('winner 为 null 时 winnerFaction 为 null（未结算状态调用）', () => {
    const r = werewolfEngine.finalize(init(1))
    expect(r.winnerFaction).toBe(null)
  })
})

describe('werewolfEngine 事件形态', () => {
  it('事件带 id/matchId/seq 占位与 gameType=werewolf', () => {
    const s = { ...makeBaseState(), phase: 'night/werewolfKill' as const, currentActor: 'w1' }
    const { events } = werewolfEngine.applyAction(s, 'w1', {
      type: 'night/werewolfKill',
      targetId: 'v1',
      reasoning: 'r',
    })
    expect(events).toHaveLength(1)
    expect(events[0].gameType).toBe('werewolf')
    expect(events[0].id).toMatch(/^evt_/)
    expect(events[0].matchId).toBe('')
    expect(events[0].seq).toBe(0)
    expect(typeof events[0].occurredAt).toBe('string')
  })
})
