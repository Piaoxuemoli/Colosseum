import { describe, it, expect } from 'vitest'
import { validate } from '@/games/werewolf/engine/validator'
import type { WerewolfAction, WerewolfState } from '@/games/werewolf/engine/types'
import { killPlayers, makeBaseState } from './_helpers'

type Override = Partial<WerewolfState>

function state(over: Override = {}): WerewolfState {
  return { ...makeBaseState(), ...over }
}

describe('validate — 通用拒绝', () => {
  it('不在游戏中的 actor 被拒绝', () => {
    const s = state()
    const r = validate(s, 'ghost', { type: 'day/vote', targetId: null })
    expect(r).toEqual({ ok: false, reason: 'actor-not-in-game' })
  })

  it('死亡玩家的一切动作被拒绝', () => {
    const s = killPlayers(state(), ['w1'])
    for (const action of [
      { type: 'day/speak', content: '我还想说话' },
      { type: 'day/vote', targetId: 'v1' },
    ] as WerewolfAction[]) {
      expect(validate(s, 'w1', action)).toEqual({ ok: false, reason: 'actor-dead' })
    }
  })
})

describe('validate — night/werewolfKill', () => {
  const kill: WerewolfAction = { type: 'night/werewolfKill', targetId: 'v1', reasoning: 'r' }

  it('轮到的狼人在正确阶段可以刀活人', () => {
    const s = state({ phase: 'night/werewolfKill', currentActor: 'w1' })
    expect(validate(s, 'w1', kill)).toEqual({ ok: true })
  })

  it('阶段不符被拒绝', () => {
    const s = state({ phase: 'night/werewolfDiscussion', currentActor: 'w1' })
    expect(validate(s, 'w1', kill)).toEqual({ ok: false, reason: 'wrong-phase' })
  })

  it('非狼人被拒绝（即使轮到他）', () => {
    const s = state({ phase: 'night/werewolfKill', currentActor: 's' })
    expect(validate(s, 's', kill)).toEqual({ ok: false, reason: 'not-werewolf' })
  })

  it('不是当前行动者的狼人被拒绝（not-your-turn）', () => {
    const s = state({ phase: 'night/werewolfKill', currentActor: 'w1' })
    expect(validate(s, 'w2', kill)).toEqual({ ok: false, reason: 'not-your-turn' })
  })

  it('刀死者被拒绝', () => {
    const s = state({ phase: 'night/werewolfKill', currentActor: 'w1' })
    expect(validate(s, 'w1', { ...kill, targetId: 'v2' })).toEqual({ ok: true })
    const s2 = killPlayers(state({ phase: 'night/werewolfKill', currentActor: 'w1' }), ['v1'])
    expect(validate(s2, 'w1', kill)).toEqual({ ok: false, reason: 'target-dead' })
  })

  it('刀不存在的目标被拒绝', () => {
    const s = state({ phase: 'night/werewolfKill', currentActor: 'w1' })
    expect(validate(s, 'w1', { ...kill, targetId: 'nobody' })).toEqual({
      ok: false,
      reason: 'target-not-in-game',
    })
  })
})

describe('validate — night/seerCheck', () => {
  const check: WerewolfAction = { type: 'night/seerCheck', targetId: 'v1' }

  it('预言家验活人合法', () => {
    const s = state({ phase: 'night/seerCheck', currentActor: 's' })
    expect(validate(s, 's', check)).toEqual({ ok: true })
  })

  it('阶段不符被拒绝', () => {
    const s = state({ phase: 'day/speak', currentActor: 's' })
    expect(validate(s, 's', check)).toEqual({ ok: false, reason: 'wrong-phase' })
  })

  it('非预言家被拒绝', () => {
    const s = state({ phase: 'night/seerCheck', currentActor: 'v1' })
    expect(validate(s, 'v1', check)).toEqual({ ok: false, reason: 'not-seer' })
  })

  it('不能查验自己', () => {
    const s = state({ phase: 'night/seerCheck', currentActor: 's' })
    expect(validate(s, 's', { type: 'night/seerCheck', targetId: 's' })).toEqual({
      ok: false,
      reason: 'cannot-check-self',
    })
  })

  it('验死者被拒绝', () => {
    const s = killPlayers(state({ phase: 'night/seerCheck', currentActor: 's' }), ['v1'])
    expect(validate(s, 's', check)).toEqual({ ok: false, reason: 'target-dead' })
  })
})

describe('validate — night/witchSave', () => {
  function witchState(over: Override = {}): WerewolfState {
    return state({
      phase: 'night/witchAction',
      currentActor: 'wi',
      lastNightKilled: 'v1',
      ...over,
    })
  }

  it('女巫在刀口存在且有药时可救人', () => {
    expect(validate(witchState(), 'wi', { type: 'night/witchSave' })).toEqual({ ok: true })
  })

  it('救人药用过后不可再救', () => {
    const s = witchState({ witchPotions: { save: false, poison: true } })
    expect(validate(s, 'wi', { type: 'night/witchSave' })).toEqual({ ok: false, reason: 'no-save-potion' })
  })

  it('当晚无人被刀时不可空救', () => {
    const s = witchState({ lastNightKilled: null })
    expect(validate(s, 'wi', { type: 'night/witchSave' })).toEqual({
      ok: false,
      reason: 'nothing-to-save',
    })
  })

  it('首夜（day=0）不能自救', () => {
    const s = witchState({ day: 0, lastNightKilled: 'wi' })
    expect(validate(s, 'wi', { type: 'night/witchSave' })).toEqual({
      ok: false,
      reason: 'first-night-self-save',
    })
  })

  it('非首夜可以自救', () => {
    const s = witchState({ day: 2, lastNightKilled: 'wi' })
    expect(validate(s, 'wi', { type: 'night/witchSave' })).toEqual({ ok: true })
  })

  it('非女巫、阶段不符均被拒绝', () => {
    expect(validate(witchState(), 'v1', { type: 'night/witchSave' })).toEqual({
      ok: false,
      reason: 'not-witch',
    })
    expect(
      validate(state({ phase: 'night/seerCheck', currentActor: 'wi', lastNightKilled: 'v1' }), 'wi', {
        type: 'night/witchSave',
      }),
    ).toEqual({ ok: false, reason: 'wrong-phase' })
  })
})

describe('validate — night/witchPoison', () => {
  function witchState(over: Override = {}): WerewolfState {
    return state({ phase: 'night/witchAction', currentActor: 'wi', ...over })
  }

  it('targetId=null 的跳过永远合法（无药也可跳过）', () => {
    expect(validate(witchState(), 'wi', { type: 'night/witchPoison', targetId: null })).toEqual({
      ok: true,
    })
    const noPotion = witchState({ witchPotions: { save: true, poison: false } })
    expect(validate(noPotion, 'wi', { type: 'night/witchPoison', targetId: null })).toEqual({
      ok: true,
    })
  })

  it('有药时可毒活人', () => {
    expect(validate(witchState(), 'wi', { type: 'night/witchPoison', targetId: 'v1' })).toEqual({
      ok: true,
    })
  })

  it('毒药用过后不可再毒', () => {
    const s = witchState({ witchPotions: { save: true, poison: false } })
    expect(validate(s, 'wi', { type: 'night/witchPoison', targetId: 'v1' })).toEqual({
      ok: false,
      reason: 'no-poison-potion',
    })
  })

  it('不能毒自己', () => {
    expect(validate(witchState(), 'wi', { type: 'night/witchPoison', targetId: 'wi' })).toEqual({
      ok: false,
      reason: 'cannot-poison-self',
    })
  })

  it('毒死者被拒绝', () => {
    const s = killPlayers(witchState(), ['v1'])
    expect(validate(s, 'wi', { type: 'night/witchPoison', targetId: 'v1' })).toEqual({
      ok: false,
      reason: 'target-dead',
    })
  })

  it('非女巫、阶段不符均被拒绝', () => {
    expect(validate(witchState(), 'v1', { type: 'night/witchPoison', targetId: 'v2' })).toEqual({
      ok: false,
      reason: 'not-witch',
    })
    expect(
      validate(state({ phase: 'day/vote', currentActor: 'wi' }), 'wi', {
        type: 'night/witchPoison',
        targetId: 'v2',
      }),
    ).toEqual({ ok: false, reason: 'wrong-phase' })
  })
})

describe('validate — day/speak', () => {
  it('白天轮到即可发言，claimedRole 可选', () => {
    const s = state({ phase: 'day/speak', day: 1, currentActor: 'v1' })
    expect(validate(s, 'v1', { type: 'day/speak', content: '我是好人' })).toEqual({ ok: true })
    expect(
      validate(s, 'v1', { type: 'day/speak', content: '我是预言家', claimedRole: 'seer' }),
    ).toEqual({ ok: true })
  })

  it('狼人夜间讨论阶段也用 day/speak（仅限狼人且轮到者）', () => {
    const s = state({ phase: 'night/werewolfDiscussion', currentActor: 'w1' })
    expect(validate(s, 'w1', { type: 'day/speak', content: '今晚刀 v1' })).toEqual({ ok: true })
    expect(validate(s, 'w2', { type: 'day/speak', content: '抢话' })).toEqual({
      ok: false,
      reason: 'not-your-turn',
    })
    expect(validate(s, 'v1', { type: 'day/speak', content: '偷听' })).toEqual({
      ok: false,
      reason: 'not-werewolf',
    })
  })

  it('其他阶段发言被拒绝', () => {
    const s = state({ phase: 'day/vote', day: 1, currentActor: 'v1' })
    expect(validate(s, 'v1', { type: 'day/speak', content: 'hi' })).toEqual({
      ok: false,
      reason: 'wrong-phase',
    })
  })

  it('不是当前发言者被拒绝', () => {
    const s = state({ phase: 'day/speak', day: 1, currentActor: 'v1' })
    expect(validate(s, 'v2', { type: 'day/speak', content: 'hi' })).toEqual({
      ok: false,
      reason: 'not-your-turn',
    })
  })

  it('超过 200 字的发言被拒绝（200 字整合法）', () => {
    const s = state({ phase: 'day/speak', day: 1, currentActor: 'v1' })
    expect(validate(s, 'v1', { type: 'day/speak', content: 'x'.repeat(200) })).toEqual({ ok: true })
    expect(validate(s, 'v1', { type: 'day/speak', content: 'x'.repeat(201) })).toEqual({
      ok: false,
      reason: 'speech-too-long',
    })
  })
})

describe('validate — day/vote', () => {
  function voteState(over: Override = {}): WerewolfState {
    return state({ phase: 'day/vote', day: 1, currentActor: 'v1', ...over })
  }

  it('投活人合法（含投自己）', () => {
    expect(validate(voteState(), 'v1', { type: 'day/vote', targetId: 'w1' })).toEqual({ ok: true })
    expect(validate(voteState(), 'v1', { type: 'day/vote', targetId: 'v1' })).toEqual({ ok: true })
  })

  it('弃票（targetId=null）合法', () => {
    expect(validate(voteState(), 'v1', { type: 'day/vote', targetId: null })).toEqual({ ok: true })
  })

  it('投死者被拒绝', () => {
    const s = killPlayers(voteState(), ['w1'])
    expect(validate(s, 'v1', { type: 'day/vote', targetId: 'w1' })).toEqual({
      ok: false,
      reason: 'target-dead',
    })
  })

  it('投不存在的人被拒绝', () => {
    expect(validate(voteState(), 'v1', { type: 'day/vote', targetId: 'ghost' })).toEqual({
      ok: false,
      reason: 'target-not-in-game',
    })
  })

  it('非投票阶段 / 非当前投票者被拒绝', () => {
    expect(validate(state({ phase: 'day/speak', currentActor: 'v1' }), 'v1', {
      type: 'day/vote',
      targetId: 'w1',
    })).toEqual({ ok: false, reason: 'wrong-phase' })
    expect(validate(voteState({ currentActor: 'v1' }), 'v2', { type: 'day/vote', targetId: 'w1' })).toEqual(
      { ok: false, reason: 'not-your-turn' },
    )
  })
})
