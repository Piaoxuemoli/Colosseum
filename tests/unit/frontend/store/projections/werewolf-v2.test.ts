// 狼人杀 v2 投影（src/frontend/store/projections/werewolf-v2.ts）：
// 以 engine2 真实事件流（脚本整场）验证 spec §6 消费侧契约——god/public
// 视角剥离（身份/死因/夜间动作）、终局揭示、日志投影、增量/批量等价、
// 未知 kind 前向兼容、agent/thinking 载荷字段保持。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deriveMatchView, useMatchViewStore } from '@/frontend/store/match-view-store'
import type { MatchViewProjection } from '@/frontend/store/match-view-store'
import {
  MATCH_ID,
  WEREWOLF_ROSTER,
  indexOfKind,
  rawEvent,
  scriptedWerewolfMatch,
  thinkingEvent,
  werewolfEnvelope,
} from './helpers'

const script = scriptedWerewolfMatch()
const events = script.events.map((event) => werewolfEnvelope(event))

function derive(viewMode: 'god' | 'public', upto?: number): MatchViewProjection {
  const slice = upto === undefined ? events : events.slice(0, upto + 1)
  return deriveMatchView(slice, { matchId: MATCH_ID, players: WEREWOLF_ROSTER }, viewMode)
}

function expectStoreMatchesDerived(viewMode: 'god' | 'public'): void {
  useMatchViewStore.getState().reset()
  useMatchViewStore.getState().init({ matchId: MATCH_ID, players: WEREWOLF_ROSTER })
  useMatchViewStore.getState().setViewMode(viewMode)
  for (const event of events) useMatchViewStore.getState().ingestEvent(event)
  const live = useMatchViewStore.getState()
  const derived = derive(viewMode)

  expect(live.werewolf).toEqual(derived.werewolf)
  expect(live.handNumber).toBe(derived.handNumber)
  expect(live.status).toBe(derived.status)
  expect(live.matchComplete).toBe(derived.matchComplete)
  expect(live.events.map((e) => e.id)).toEqual(derived.events.map((e) => e.id))
  expect(live.events.map((e) => e.handNumberAt)).toEqual(derived.events.map((e) => e.handNumberAt))
}

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(1_723_000_000_000)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('werewolf v2 projection — equivalence and logs', () => {
  it('incremental store ingest === batch derive (god view)', () => {
    expectStoreMatchesDerived('god')
  })

  it('incremental store ingest === batch derive (public view)', () => {
    expectStoreMatchesDerived('public')
  })

  it('tracks day/phase from phaseEntered and uses day as the bucket key', () => {
    const nightSeer = indexOfKind(events, 'werewolf:v2:phaseEntered', 3) // 夜 1 预言家步骤
    expect(derive('god', nightSeer).werewolf.phase).toBe('night.seer')

    const dayAnnounce = indexOfKind(events, 'werewolf:v2:deathsAnnounced', 0)
    const atDawn = derive('god', dayAnnounce)
    expect(atDawn.werewolf.day).toBe(1)
    expect(atDawn.werewolf.phase).toBe('day.announce')
    // day 即事件分桶键（handNumberAt 与 handNumber 同步）。
    expect(atDawn.events[dayAnnounce].handNumberAt).toBe(1)
  })

  it('projects speeches, last words and votes with day grouping', () => {
    const final = derive('public')
    // 昼 1：p3 夜死遗言 + 全员发言。
    const day1Speeches = final.werewolf.speechLog.filter((entry) => entry.day === 1)
    expect(day1Speeches.some((entry) => entry.agentId === 'p3' && entry.content.includes('真预言家'))).toBe(true)
    expect(day1Speeches.filter((entry) => entry.content === '我是好人').length).toBe(5)
    // 投票日志：昼 1 主轮 5 票（p5 3 票被放逐）。
    const day1Votes = final.werewolf.voteLog.filter((entry) => entry.day === 1)
    expect(day1Votes).toHaveLength(5)
    expect(day1Votes.filter((entry) => entry.target === 'p5')).toHaveLength(3)
  })
})

describe('werewolf v2 projection — god view', () => {
  it('accumulates roles from role-self rolesAssigned events during play', () => {
    const lastRole = indexOfKind(events, 'werewolf:v2:rolesAssigned', 5)
    const god = derive('god', lastRole)
    expect(god.werewolf.roleAssignments).toEqual({
      p1: 'werewolf',
      p2: 'werewolf',
      p3: 'seer',
      p4: 'witch',
      p5: 'villager',
      p6: 'villager',
    })
  })

  it('narrates private night actions (wolf channel / seer / witch) as moderator lines', () => {
    const afterSeerCheck = indexOfKind(events, 'werewolf:v2:seerChecked', 0)
    const god = derive('god', afterSeerCheck)
    const narration = god.werewolf.moderatorNarration.map((entry) => entry.narration).join('\n')
    expect(narration).toContain('狼队互识')
    expect(narration).toContain('刀口商定')
    expect(narration).toContain('预言家查验 P1：狼人')
  })

  it('sees settled night deaths with causes before the dawn announcement', () => {
    const settled = indexOfKind(events, 'werewolf:v2:nightSettled', 0)
    const god = derive('god', settled)
    expect(god.werewolf.deaths).toEqual([{ agentId: 'p3', day: 1, cause: 'wolf-kill' }])
  })
})

describe('werewolf v2 projection — public view stripping', () => {
  it('hides roles until the gameEnded reveal (public facts only)', () => {
    const lastVote = indexOfKind(events, 'werewolf:v2:voteCast')
    const preReveal = derive('public', lastVote)
    expect(preReveal.werewolf.roleAssignments).toBeNull()

    const final = derive('public')
    expect(final.werewolf.roleAssignments).toEqual({
      p1: 'werewolf',
      p2: 'werewolf',
      p3: 'seer',
      p4: 'witch',
      p5: 'villager',
      p6: 'villager',
    })
  })

  it('never narrates night actions in the public stream', () => {
    const final = derive('public')
    const narration = final.werewolf.moderatorNarration.map((entry) => entry.narration).join('\n')
    expect(narration).not.toContain('狼队互识')
    expect(narration).not.toContain('查验')
    expect(narration).not.toContain('解药')
    expect(narration).toContain('天亮了') // 公开公告仍在
  })

  it('announces night deaths without causes pre-reveal (board default: deathCauseRevealed off)', () => {
    const announced = indexOfKind(events, 'werewolf:v2:deathsAnnounced', 0)
    const pub = derive('public', announced)
    expect(pub.werewolf.deaths).toEqual([{ agentId: 'p3', day: 1, cause: null }])

    const god = derive('god', announced)
    expect(god.werewolf.deaths).toEqual([{ agentId: 'p3', day: 1, cause: 'wolf-kill' }])
  })

  it('keeps public-cause deaths (exile/shot) visible in both views', () => {
    const exile = indexOfKind(events, 'werewolf:v2:voteResult', 0)
    for (const viewMode of ['god', 'public'] as const) {
      const view = derive(viewMode, exile)
      expect(view.werewolf.deaths.find((death) => death.agentId === 'p5')).toEqual({
        agentId: 'p5',
        day: 1,
        cause: 'exile',
      })
    }
  })

  it('fills every death cause from the gameEnded reveal (delayed full disclosure)', () => {
    const final = derive('public')
    expect(final.werewolf.deaths).toEqual([
      { agentId: 'p3', day: 1, cause: 'wolf-kill' },
      { agentId: 'p5', day: 1, cause: 'exile' },
    ])
  })
})

describe('werewolf v2 projection — endgame', () => {
  it('settles winner/matchComplete/status from gameEnded', () => {
    const final = derive('public')
    expect(final.werewolf.winner).toBe('werewolves')
    expect(final.matchComplete).toBe(true)
    expect(final.status).toBe('settled')
    expect(final.currentActor).toBeNull()
  })
})

describe('werewolf v2 projection — forward compatibility & thinking payload', () => {
  it('silently ignores unknown v2 kinds', () => {
    const unknown = rawEvent('werewolf', 'werewolf:v2:quantum-lynch', {
      seq: 99,
      day: 1,
      audience: { kind: 'public' },
      actorId: 'p1',
      kind: 'quantum-lynch',
      payload: {},
    })
    const withUnknown = [...events, unknown]
    const a = deriveMatchView(withUnknown, { matchId: MATCH_ID, players: WEREWOLF_ROSTER }, 'god')
    const b = derive('god')

    expect(a.events).toHaveLength(b.events.length + 1)
    expect(a.events.at(-1)?.kind).toBe('werewolf:v2:quantum-lynch')
    expect(a.werewolf).toEqual(b.werewolf)
    expect(a.handNumber).toBe(b.handNumber)
    expect(a.status).toBe(b.status)
  })

  it('keeps agent/thinking payloads (day/phase) intact through the shared reducer', () => {
    // spec §3：GM 持久化 agent/thinking 时 day/phase 从 v2 状态读出——
    // 固定在合成流中：payload 逐字段保留，狼人投影不受影响。
    const speechIdx = indexOfKind(events, 'werewolf:v2:speech', 0)
    const thinking = thinkingEvent('p5', 1, 'day.speech', '我在想谁是狼…')
    const withThinking = [...events.slice(0, speechIdx + 1), thinking, ...events.slice(speechIdx + 1)]
    const a = deriveMatchView(withThinking, { matchId: MATCH_ID, players: WEREWOLF_ROSTER }, 'public')
    const b = derive('public')

    const stored = a.events.find((event) => event.id === thinking.id)
    expect(stored?.kind).toBe('agent/thinking')
    expect(stored?.payload.day).toBe(1)
    expect(stored?.payload.phase).toBe('day.speech')
    expect(stored?.payload.handNumber).toBe(0)
    expect(a.werewolf).toEqual(b.werewolf)
  })
})
