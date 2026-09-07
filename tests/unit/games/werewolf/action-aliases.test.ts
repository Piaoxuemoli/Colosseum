import { describe, it, expect } from 'vitest'
import {
  WEREWOLF_ACTION_TYPES,
  normalizeWerewolfActionType,
} from '@/games/werewolf/engine/werewolf-action-aliases'

describe('WEREWOLF_ACTION_TYPES', () => {
  it('枚举与 WerewolfAction 联合类型的 type 一一对应', () => {
    expect(WEREWOLF_ACTION_TYPES).toEqual([
      'night/werewolfKill',
      'night/seerCheck',
      'night/witchSave',
      'night/witchPoison',
      'day/speak',
      'day/vote',
    ])
  })
})

describe('normalizeWerewolfActionType — 规范类型直通', () => {
  it('所有 canonical 输入原样返回（幂等）', () => {
    for (const t of WEREWOLF_ACTION_TYPES) {
      expect(normalizeWerewolfActionType(t)).toBe(t)
      // 幂等：规范化结果再规范化不变
      const once = normalizeWerewolfActionType(t)
      expect(normalizeWerewolfActionType(once as string)).toBe(t)
    }
  })
})

describe('normalizeWerewolfActionType — 形状归一（前缀/大小写/分隔符）', () => {
  const cases: Array<[string, string]> = [
    ['night/werewolfKill', 'night/werewolfKill'],
    ['night_werewolfKill', 'night/werewolfKill'],
    ['night-werewolf-kill', 'night/werewolfKill'],
    ['night/werewolf_kill', 'night/werewolfKill'],
    ['WEREWOLFKILL', 'night/werewolfKill'],
    ['night/seerCheck', 'night/seerCheck'],
    ['seer_check', 'night/seerCheck'],
    ['seerCheck', 'night/seerCheck'],
    ['SEERCHECK', 'night/seerCheck'],
    ['witch_save', 'night/witchSave'],
    ['witchSave', 'night/witchSave'],
    ['witch-poison', 'night/witchPoison'],
    ['witchPoison', 'night/witchPoison'],
    ['day_speak', 'day/speak'],
    ['day-speak', 'day/speak'],
    ['speak', 'day/speak'],
    ['day/vote', 'day/vote'],
    ['day_vote', 'day/vote'],
    ['Day/Vote', 'day/vote'],
    ['VOTE', 'day/vote'],
  ]
  it.each(cases)('%s → %s', (input, expected) => {
    expect(normalizeWerewolfActionType(input)).toBe(expected)
  })
})

describe('normalizeWerewolfActionType — 语义别名', () => {
  const aliases: Array<[string, string]> = [
    ['kill', 'night/werewolfKill'],
    ['murder', 'night/werewolfKill'],
    ['check', 'night/seerCheck'],
    ['verify', 'night/seerCheck'],
    ['save', 'night/witchSave'],
    ['heal', 'night/witchSave'],
    ['rescue', 'night/witchSave'],
    ['poison', 'night/witchPoison'],
    ['skip', 'day/vote'],
    ['pass', 'day/vote'],
    ['abstain', 'day/vote'],
    ['say', 'day/speak'],
    ['talk', 'day/speak'],
    ['claim', 'day/speak'],
  ]
  it.each(aliases)('%s → %s', (input, expected) => {
    expect(normalizeWerewolfActionType(input)).toBe(expected)
  })

  it('skip/pass/abstain 归到 day/vote（唯一允许 null target 的弃票动作）', () => {
    for (const a of ['skip', 'pass', 'abstain']) {
      expect(normalizeWerewolfActionType(a)).toBe('day/vote')
    }
  })
})

describe('normalizeWerewolfActionType — 非狼人杀动作返回 null', () => {
  it('扑克类、未知词、空串均返回 null', () => {
    for (const t of [
      'hand/bet',
      'poker/raise',
      'raise',
      'fold',
      'dance',
      '',
      'night/stare',
      'day/execute',
      'announce',
      'werewolfChat',
    ]) {
      expect(normalizeWerewolfActionType(t)).toBe(null)
    }
  })

  it('null 返回值让上层可回落到 fallback 而非产出非法动作', () => {
    expect(normalizeWerewolfActionType('definitely-not-an-action')).toBe(null)
  })
})
