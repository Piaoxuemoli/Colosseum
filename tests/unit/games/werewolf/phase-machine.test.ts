import { describe, it, expect } from 'vitest'
import { advancePhase } from '@/games/werewolf/engine/phase-machine'
import type { WerewolfState } from '@/games/werewolf/engine/types'
import { killPlayers, makeBaseState, playerOf } from './_helpers'

function state(over: Partial<WerewolfState> = {}): WerewolfState {
  return { ...makeBaseState(), ...over }
}

describe('advancePhase — 夜间阶段顺序', () => {
  it('night/werewolfKill → night/seerCheck，行动者切到预言家', () => {
    const next = advancePhase(state({ phase: 'night/werewolfKill', currentActor: 'w1' }))
    expect(next.phase).toBe('night/seerCheck')
    expect(next.currentActor).toBe('s')
  })

  it('night/seerCheck → night/witchAction，行动者切到女巫', () => {
    const next = advancePhase(state({ phase: 'night/seerCheck', currentActor: 's' }))
    expect(next.phase).toBe('night/witchAction')
    expect(next.currentActor).toBe('wi')
  })

  it('预言家已死 → 跳过 seerCheck 直达 witchAction（无 currentActor=null 死锁）', () => {
    const s = killPlayers(state({ phase: 'night/werewolfKill', currentActor: 'w1' }), ['s'])
    const next = advancePhase(s)
    expect(next.phase).toBe('night/witchAction')
    expect(next.currentActor).toBe('wi')
  })

  it('女巫已死 → 跳过 witchAction，死亡结算后直接进入白天发言', () => {
    // 预死 wi 与 w2，避免夜间死亡后形成狼均势提前终局
    const s = killPlayers(
      state({ phase: 'night/seerCheck', currentActor: 's', lastNightKilled: 'v1' }),
      ['wi', 'w2'],
    )
    const next = advancePhase(s)
    expect(next.phase).toBe('day/speak')
    expect(next.day).toBe(1)
    expect(next.currentActor).toBe('w1')
    expect(playerOf(next, 'v1').alive).toBe(false)
  })

  it('预言家与女巫均已死（且少一狼）→ 级联直达 day/speak', () => {
    const s = killPlayers(state({ phase: 'night/werewolfKill', currentActor: 'w1' }), [
      'w2',
      's',
      'wi',
    ])
    const next = advancePhase(s)
    expect(next.phase).toBe('day/speak')
    expect(next.day).toBe(1)
    expect(next.currentActor).toBe('w1')
    expect(next.speechQueue).toEqual(['v1', 'v2'])
  })

  it('夜间死亡直接终结比赛时：立即结算且 currentActor=null（不卡空阶段）', () => {
    const s = killPlayers(
      state({ phase: 'night/witchAction', currentActor: null, lastNightKilled: 'v1' }),
      ['s', 'wi'],
    )
    const next = advancePhase(s)
    expect(next.matchComplete).toBe(true)
    expect(next.winner).toBe('werewolves')
    expect(next.currentActor).toBe(null)
    expect(playerOf(next, 'v1').alive).toBe(false)
  })
})

describe('advancePhase — 夜间死亡结算（night/witchAction → day/speak）', () => {
  function dawn(over: Partial<WerewolfState> = {}): WerewolfState {
    return advancePhase(state({ phase: 'night/witchAction', currentActor: 'wi', ...over }))
  }

  it('无刀无药 → 天亮无人死亡，day+1，发言队列 = 全部存活者', () => {
    const next = dawn()
    expect(next.phase).toBe('day/speak')
    expect(next.day).toBe(1)
    expect(next.currentActor).toBe('w1')
    expect(next.speechQueue).toEqual(['w2', 's', 'wi', 'v1', 'v2'])
    expect(next.players.every((p) => p.alive)).toBe(true)
  })

  it('狼刀生效：死者标记 deathDay/deathCause=werewolfKill', () => {
    const next = dawn({ lastNightKilled: 'v1' })
    const v1 = playerOf(next, 'v1')
    expect(v1.alive).toBe(false)
    expect(v1.deathDay).toBe(0)
    expect(v1.deathCause).toBe('werewolfKill')
    expect(next.speechQueue).not.toContain('v1')
  })

  it('女巫救起刀口 → 该玩家存活', () => {
    const next = dawn({ lastNightKilled: 'v1', lastNightSaved: 'v1' })
    expect(playerOf(next, 'v1').alive).toBe(true)
    expect(next.lastNightKilled).toBe(null)
    expect(next.lastNightSaved).toBe(null)
  })

  it('狼刀 + 毒另一人 → 双死且死因各自正确', () => {
    const next = dawn({ lastNightKilled: 'v1', lastNightPoisoned: 'v2' })
    expect(playerOf(next, 'v1')).toMatchObject({ alive: false, deathCause: 'werewolfKill' })
    expect(playerOf(next, 'v2')).toMatchObject({ alive: false, deathCause: 'witchPoison' })
  })

  it('毒与刀同一目标 → 只死一人，死因记为狼刀', () => {
    const next = dawn({ lastNightKilled: 'v1', lastNightPoisoned: 'v1' })
    expect(playerOf(next, 'v1')).toMatchObject({ alive: false, deathCause: 'werewolfKill' })
    const deadCount = next.players.filter((p) => !p.alive).length
    expect(deadCount).toBe(1)
  })

  it('救人后再毒第三方 → 被救者存活、被毒者死亡', () => {
    const next = dawn({ lastNightKilled: 'v1', lastNightSaved: 'v1', lastNightPoisoned: 'w2' })
    expect(playerOf(next, 'v1').alive).toBe(true)
    expect(playerOf(next, 'w2')).toMatchObject({ alive: false, deathCause: 'witchPoison' })
  })

  it('夜间死亡触发均势 → 当夜直接判狼胜', () => {
    const s = killPlayers(state({ phase: 'night/witchAction', currentActor: 'wi', lastNightKilled: 'v1' }), [
      's',
      'wi',
      'v2',
    ])
    const next = advancePhase(s)
    expect(next.matchComplete).toBe(true)
    expect(next.winner).toBe('werewolves')
  })
})

describe('advancePhase — 白天阶段顺序', () => {
  it('day/speak 依次弹出 speechQueue，队列空后进入 day/vote', () => {
    const s = state({
      phase: 'day/speak',
      day: 1,
      currentActor: 'v1',
      speechQueue: ['v2'],
    })
    const mid = advancePhase(s)
    expect(mid.phase).toBe('day/speak')
    expect(mid.currentActor).toBe('v2')
    expect(mid.speechQueue).toEqual([])

    const vote = advancePhase(mid)
    expect(vote.phase).toBe('day/vote')
    expect(vote.currentActor).toBe('w1') // 首个存活者（座位序）
  })

  it('day/speak 队列已空 → 直接进入 day/vote', () => {
    const s = state({ phase: 'day/speak', day: 1, currentActor: 'v2', speechQueue: [] })
    const next = advancePhase(s)
    expect(next.phase).toBe('day/vote')
    expect(next.currentActor).toBe('w1')
  })

  it('day/vote 多数票放逐 → 夜间讨论阶段，队列=存活狼人', () => {
    const s = state({
      phase: 'day/vote',
      day: 1,
      currentActor: 'v2',
      voteLog: [
        { day: 1, voter: 'w1', target: 's', at: 0 },
        { day: 1, voter: 'w2', target: 's', at: 0 },
        { day: 1, voter: 's', target: 'w1', at: 0 },
        { day: 1, voter: 'wi', target: 's', at: 0 },
        { day: 1, voter: 'v1', target: 's', at: 0 },
        { day: 1, voter: 'v2', target: 's', at: 0 },
      ],
    })
    const next = advancePhase(s)
    expect(playerOf(next, 's')).toMatchObject({ alive: false, deathDay: 1, deathCause: 'vote' })
    expect(next.phase).toBe('night/werewolfDiscussion')
    expect(next.day).toBe(1)
    expect(next.werewolfDiscussionQueue).toEqual(['w2'])
    expect(next.currentActor).toBe('w1')
  })

  it('day/vote 平票 → 无人被放逐，照常入夜', () => {
    const s = state({
      phase: 'day/vote',
      day: 1,
      currentActor: 'v2',
      voteLog: [
        { day: 1, voter: 'w1', target: 's', at: 0 },
        { day: 1, voter: 'w2', target: 's', at: 0 },
        { day: 1, voter: 's', target: 'w1', at: 0 },
        { day: 1, voter: 'wi', target: 'w1', at: 0 },
        { day: 1, voter: 'v1', target: null, at: 0 },
        { day: 1, voter: 'v2', target: null, at: 0 },
      ],
    })
    const next = advancePhase(s)
    expect(next.players.every((p) => p.alive)).toBe(true)
    expect(next.phase).toBe('night/werewolfDiscussion')
  })

  it('day/vote 全员弃票 → 无人死亡，入夜', () => {
    const s = state({
      phase: 'day/vote',
      day: 1,
      currentActor: 'v2',
      voteLog: [
        { day: 1, voter: 'w1', target: null, at: 0 },
        { day: 1, voter: 'w2', target: null, at: 0 },
        { day: 1, voter: 's', target: null, at: 0 },
        { day: 1, voter: 'wi', target: null, at: 0 },
        { day: 1, voter: 'v1', target: null, at: 0 },
        { day: 1, voter: 'v2', target: null, at: 0 },
      ],
    })
    const next = advancePhase(s)
    expect(next.players.every((p) => p.alive)).toBe(true)
    expect(next.phase).toBe('night/werewolfDiscussion')
  })

  it('只统计当天的投票（前一天的票不影响今天的计票）', () => {
    const s = state({
      phase: 'day/vote',
      day: 2,
      currentActor: 'v2',
      voteLog: [
        // day 1：s 拿了 4 票（历史）
        { day: 1, voter: 'w1', target: 's', at: 0 },
        { day: 1, voter: 'w2', target: 's', at: 0 },
        { day: 1, voter: 'wi', target: 's', at: 0 },
        { day: 1, voter: 'v1', target: 's', at: 0 },
        // day 2：v1 拿 2 票唯一多数。若日期过滤失效，s 会以 4 票压过 v1 被错误放逐
        { day: 2, voter: 'w1', target: 'v1', at: 0 },
        { day: 2, voter: 'w2', target: 'v1', at: 0 },
      ],
    })
    const next = advancePhase(s)
    expect(playerOf(next, 'v1').alive).toBe(false)
    expect(playerOf(next, 's').alive).toBe(true)
  })

  it('放逐最后一头狼 → 当场结算好人胜（phase 停在 day/execute）', () => {
    const s = killPlayers(
      state({
        phase: 'day/vote',
        day: 2,
        currentActor: 'v2',
        voteLog: [
          { day: 2, voter: 'w2', target: 'v1', at: 0 },
          { day: 2, voter: 'wi', target: 'w2', at: 0 },
          { day: 2, voter: 'v1', target: 'w2', at: 0 },
          { day: 2, voter: 'v2', target: 'w2', at: 0 },
        ],
      }),
      ['w1', 's'],
    )
    const next = advancePhase(s)
    expect(next.matchComplete).toBe(true)
    expect(next.winner).toBe('villagers')
    expect(next.currentActor).toBe(null)
    expect(playerOf(next, 'w2')).toMatchObject({ alive: false, deathCause: 'vote' })
  })
})

describe('advancePhase — 遗留阶段（announce / execute）', () => {
  it('day/announce → day/speak 并重建发言队列（day 不重复 +1）', () => {
    const next = advancePhase(state({ phase: 'day/announce', day: 1 }))
    expect(next.phase).toBe('day/speak')
    expect(next.day).toBe(1)
    expect(next.currentActor).toBe('w1')
    expect(next.speechQueue).toEqual(['w2', 's', 'wi', 'v1', 'v2'])
  })

  it('day/execute（无人被放逐/未结算）→ 夜间讨论', () => {
    const next = advancePhase(state({ phase: 'day/execute', day: 1 }))
    expect(next.phase).toBe('night/werewolfDiscussion')
    expect(next.werewolfDiscussionQueue).toEqual(['w2'])
    expect(next.currentActor).toBe('w1')
  })

  it('day/execute 携带多数票 → 放逐生效并可能终结比赛', () => {
    const s = killPlayers(
      state({
        phase: 'day/execute',
        day: 1,
        voteLog: [
          { day: 1, voter: 's', target: 'w1', at: 0 },
          { day: 1, voter: 'wi', target: 'w1', at: 0 },
          { day: 1, voter: 'v1', target: 'w1', at: 0 },
          { day: 1, voter: 'v2', target: 'w1', at: 0 },
        ],
      }),
      ['w2'],
    )
    const next = advancePhase(s)
    expect(playerOf(next, 'w1').alive).toBe(false)
    expect(next.matchComplete).toBe(true)
    expect(next.winner).toBe('villagers')
  })
})

describe('advancePhase — 纯函数性', () => {
  it('不修改传入的状态对象（深拷贝语义）', () => {
    const s = state({ phase: 'night/witchAction', currentActor: 'wi', lastNightKilled: 'v1' })
    const snapshot = structuredClone(s)
    advancePhase(s)
    expect(s).toEqual(snapshot)
  })
})
