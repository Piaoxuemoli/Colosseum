/**
 * plugin-v2 normalizeAction 包装的单测（spec §2/§4）：
 * 引擎 normalize + LLM 别名容错（中英文 / 旧 phase 前缀 / 键名互换 /
 * check↔call·bet↔raise 语境互换），以及拒绝始终结构化。
 */

import { describe, expect, it } from 'vitest'
import { pokerPluginV2 } from '@/games/poker/integration/plugin-v2'
import { werewolfPluginV2 } from '@/games/werewolf/integration/plugin-v2'
import { createMatch as pokerCreate } from '@/games/poker/engine2'
import { BOARD_PRESET_6P_BASE, createMatchFromSeating, parseBoard } from '@/games/werewolf/engine2'
import type { MatchState } from '@/games/poker/engine2'
import type { WerewolfEngineState } from '@/games/werewolf/engine2'

function pokerStateAtFirstAction(): { state: MatchState; actor: string } {
  const created = pokerCreate(
    { seatIds: ['a', 'b', 'c'], startingStack: 200, blinds: { sb: 2, bb: 4 } },
    'seed-test',
  )
  if (!created.ok) throw new Error('poker createMatch failed')
  const actor = created.state.currentActor
  if (actor === null) throw new Error('no actor after create')
  return { state: created.state, actor }
}

function werewolfStateAtFirstNight(): { state: WerewolfEngineState; wolf: string; villager: string } {
  // 固定座次：a=狼, b=狼, c=预言家, d=女巫, e/f=平民（首夜由狼先行动）
  const board = parseBoard(BOARD_PRESET_6P_BASE)
  if (!board.ok) throw new Error('preset board rejected')
  const created = createMatchFromSeating({
    board: board.board,
    seating: ['werewolf', 'werewolf', 'seer', 'witch', 'villager', 'villager'],
    playerIds: ['a', 'b', 'c', 'd', 'e', 'f'],
    seed: 12345,
  })
  if (created.status !== 'created') throw new Error('werewolf createMatch failed')
  const wolf = created.state.pendingActor
  if (wolf === null) throw new Error('no pending actor after create')
  return { state: created.state, wolf, villager: 'e' }
}

describe('poker plugin-v2 normalizeAction（LLM 别名容错）', () => {
  it('accepts canonical types unchanged', () => {
    const { state, actor } = pokerStateAtFirstAction()
    const result = pokerPluginV2.normalizeAction({ type: 'call' }, state, actor)
    expect(result.ok).toBe(true)
  })

  it('maps aliases: allIn / 全下 / shove → all-in', () => {
    const { state, actor } = pokerStateAtFirstAction()
    for (const alias of ['allIn', 'all_in', '全下', '全押', 'shove']) {
      const result = pokerPluginV2.normalizeAction({ type: alias }, state, actor)
      expect(result.ok, `alias ${alias}`).toBe(true)
      if (result.ok) expect(result.action.type).toBe('all-in')
    }
  })

  it('maps Chinese action words (跟注/加注)', () => {
    const { state, actor } = pokerStateAtFirstAction()
    expect(pokerPluginV2.normalizeAction({ type: '跟注' }, state, actor).ok).toBe(true)
    const raise = pokerPluginV2.normalizeAction({ type: '加注', toAmount: 12 }, state, actor)
    expect(raise.ok).toBe(true)
  })

  it('swaps check↔call and bet↔raise by betting context', () => {
    const { state, actor } = pokerStateAtFirstAction()
    // preflop 有盲注：check 语境互换为 call；bet 互换为 raise
    const check = pokerPluginV2.normalizeAction({ type: 'check' }, state, actor)
    expect(check.ok).toBe(true)
    if (check.ok) expect(check.action.type).toBe('call')
    const bet = pokerPluginV2.normalizeAction({ type: 'bet', amount: 10 }, state, actor)
    expect(bet.ok).toBe(true)
    if (bet.ok) expect(bet.action.type).toBe('raise')

    // 造一个无注街（全员跟注 → BB 过牌权 → flop）验证 call→check 语境互换
    let s = state
    for (let i = 0; i < 9 && s.phase === 'awaiting-action'; i++) {
      const actorNow = s.currentActor
      if (actorNow === null) break
      const norm = pokerPluginV2.normalizeAction({ type: 'call' }, s, actorNow)
      if (!norm.ok) break
      const outcome = pokerPluginV2.applyAction(s, actorNow, norm.action)
      if (!outcome.ok) break
      s = outcome.state
      if (s.hand?.street === 'flop' && s.phase === 'awaiting-action' && s.currentActor) {
        const flop = pokerPluginV2.normalizeAction({ type: 'call' }, s, s.currentActor)
        expect(flop.ok).toBe(true)
        if (flop.ok) expect(flop.action.type).toBe('check')
        break
      }
    }
  })

  it('accepts amount↔toAmount key interchange for raise', () => {
    const { state, actor } = pokerStateAtFirstAction()
    const result = pokerPluginV2.normalizeAction({ type: 'raise', amount: 8 }, state, actor)
    expect(result.ok).toBe(true)
  })

  it('rejects unknown types and illegal amounts with structured rejections', () => {
    const { state, actor } = pokerStateAtFirstAction()
    const bogus = pokerPluginV2.normalizeAction({ type: 'explode' }, state, actor)
    expect(bogus.ok).toBe(false)
    if (!bogus.ok) expect(typeof bogus.rejection.code).toBe('string')

    const tooSmall = pokerPluginV2.normalizeAction({ type: 'bet', amount: 1 }, state, actor)
    expect(tooSmall.ok).toBe(false)
    if (!tooSmall.ok) expect(tooSmall.rejection.code).toBe('AMOUNT_BELOW_MIN')
  })

  it('rejects actions from a non-actor seat', () => {
    const { state, actor } = pokerStateAtFirstAction()
    const other = state.players.find((player) => player.seatId !== actor)?.seatId ?? 'zzz'
    const result = pokerPluginV2.normalizeAction({ type: 'fold' }, state, other)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.rejection.code).toBe('NOT_CURRENT_ACTOR')
  })
})

describe('werewolf plugin-v2 normalizeAction（LLM 别名容错）', () => {
  it('accepts canonical v2 types with actorId injection', () => {
    const { state, wolf } = werewolfStateAtFirstNight()
    const result = werewolfPluginV2.normalizeAction({ type: 'kill', targetId: 'e' }, state, wolf)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.action.type).toBe('kill')
      expect((result.action as { actorId: string }).actorId).toBe(wolf)
    }
  })

  it('maps legacy v1 phase-prefixed types (night/werewolfKill → kill)', () => {
    const { state, wolf } = werewolfStateAtFirstNight()
    for (const alias of ['night/werewolfKill', 'werewolfKill', 'kill', 'murder']) {
      const result = werewolfPluginV2.normalizeAction({ type: alias, targetId: 'e' }, state, wolf)
      expect(result.ok, `alias ${alias}`).toBe(true)
      if (result.ok) expect(result.action.type).toBe('kill')
    }
  })

  it('maps Chinese action words (投票/发言/查验)', () => {
    // 投票需要 day.vote 阶段：用 speak 在 day.speech 阶段验证中文映射
    const { state, wolf } = werewolfStateAtFirstNight()
    // 推进到首个白天发言位：狼空刀 → 女巫/预言家 pass → 天亮 → 发言
    let s = state
    const steps = 6
    for (let i = 0; i < steps && s.phase !== 'day.speech' && s.phase !== 'ended'; i++) {
      const outcome = werewolfPluginV2.applyDefaultAction(s)
      if (!outcome.ok) break
      s = outcome.state
    }
    const speaker = s.pendingActor
    if (speaker !== null && (s.phase === 'day.speech' || s.phase === 'day.pkSpeech')) {
      const speak = werewolfPluginV2.normalizeAction({ type: '发言', content: '我是好人' }, s, speaker)
      expect(speak.ok).toBe(true)
      if (speak.ok) {
        expect(speak.action.type).toBe('speak')
        expect((speak.action as { content?: string }).content).toBe('我是好人')
      }
    } else {
      throw new Error(`expected day.speech, got ${s.phase}`)
    }
    void wolf
  })

  it('resolves contextual pass aliases against the legal action set (seerPass)', () => {
    const { state } = werewolfStateAtFirstNight()
    // 推进到 night.seer（狼 ×2 空刀）
    let s = state
    for (let i = 0; i < 2; i++) {
      const outcome = werewolfPluginV2.applyDefaultAction(s)
      if (!outcome.ok) throw new Error('default action rejected')
      s = outcome.state
    }
    // 女巫两问 pass（auto 推进或显式 pass）
    while (s.phase === 'night.witch.save' || s.phase === 'night.witch.poison') {
      const outcome = werewolfPluginV2.applyDefaultAction(s)
      if (!outcome.ok) throw new Error('witch default rejected')
      s = outcome.state
    }
    expect(s.phase).toBe('night.seer')
    const seer = s.pendingActor
    expect(seer).toBe('c')
    const pass = werewolfPluginV2.normalizeAction({ type: 'skip' }, s, seer ?? 'c')
    expect(pass.ok).toBe(true)
    if (pass.ok) expect(pass.action.type).toBe('seerPass')
  })

  it('clamps speech content to the board budget', () => {
    const { state } = werewolfStateAtFirstNight()
    let s = state
    for (let i = 0; i < 20 && !(s.phase === 'day.speech' || s.phase === 'day.pkSpeech'); i++) {
      const outcome = werewolfPluginV2.applyDefaultAction(s)
      if (!outcome.ok) break
      s = outcome.state
    }
    const speaker = s.pendingActor
    expect(speaker).not.toBeNull()
    const long = '话'.repeat(500)
    const result = werewolfPluginV2.normalizeAction({ type: 'speak', content: long }, s, speaker ?? 'a')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect((result.action as { content?: string }).content?.length).toBe(s.board.speechMaxLength)
    }
  })

  it('rejects types that are not legal in the current phase (structured UNPARSEABLE)', () => {
    const { state, wolf } = werewolfStateAtFirstNight()
    const vote = werewolfPluginV2.normalizeAction({ type: 'day/vote', targetId: 'e' }, state, wolf)
    expect(vote.ok).toBe(false)
    if (!vote.ok) expect(vote.rejection.code).toBe('UNPARSEABLE')

    const garbage = werewolfPluginV2.normalizeAction({ nope: true }, state, wolf)
    expect(garbage.ok).toBe(false)
  })

  it('applyAction adjudicates illegal targets after normalize (engine is the arbiter)', () => {
    const { state, wolf } = werewolfStateAtFirstNight()
    const deadTarget = werewolfPluginV2.normalizeAction({ type: 'kill', targetId: 'not-a-player' }, state, wolf)
    expect(deadTarget.ok).toBe(true) // 形状合法
    if (deadTarget.ok) {
      const applied = werewolfPluginV2.applyAction(state, wolf, deadTarget.action)
      expect(applied.ok).toBe(false) // 引擎裁决 ILLEGAL_TARGET
      if (!applied.ok) expect(applied.rejection.code).toBe('ILLEGAL_TARGET')
    }
  })
})
