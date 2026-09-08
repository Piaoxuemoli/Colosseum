// 回放阶段跳转（FR-4.6-02）：边界推导纯函数——扑克按 hand-started（含
// legacy poker/hand-start），狼人杀按 phaseEntered 昼夜切换（含 legacy
// moderator-narrate 的 day 变化）；导航函数（active/next/prev）语义。

import { describe, expect, it } from 'vitest'
import {
  activeBoundaryIndex,
  computeReplayBoundaries,
  detectGameOfEvents,
  nextBoundary,
  prevBoundary,
  type ReplayBoundary,
} from '@/frontend/store/projections/replay-boundaries'
import { pokerEnvelope, rawEvent, scriptedPokerMatch, scriptedWerewolfMatch, werewolfEnvelope } from './helpers'

const pokerScript = scriptedPokerMatch()
const pokerEvents = pokerScript.events.map((event) => pokerEnvelope(event))

const werewolfScript = scriptedWerewolfMatch()
const werewolfEvents = werewolfScript.events.map((event) => werewolfEnvelope(event))

describe('replay-boundaries — 扑克（按手）', () => {
  it('creates one boundary per hand-started, labeled by hand number', () => {
    const boundaries = computeReplayBoundaries(pokerEvents)
    // 脚本整场：手 1（连续弃牌）+ 手 2（摊牌）。
    expect(boundaries.map((boundary) => boundary.label)).toEqual(['第 1 手', '第 2 手'])
    expect(boundaries.every((boundary) => boundary.kind === 'hand')).toBe(true)
  })

  it('seekIndex points just past the boundary event (cursor after seek applies it)', () => {
    const boundaries = computeReplayBoundaries(pokerEvents)
    const handOne = pokerEvents.findIndex((event) => event.kind === 'poker:v2:hand-started')
    const handTwo = pokerEvents.findIndex((event, index) => index > handOne && event.kind === 'poker:v2:hand-started')
    expect(handOne).toBeGreaterThanOrEqual(0)
    expect(boundaries[0].seekIndex).toBe(handOne + 1)
    expect(boundaries[1].seekIndex).toBe(handTwo + 1)
    // seek 后该手事件已应用于视图。
    expect(boundaries[1].seekIndex).toBeLessThanOrEqual(pokerEvents.length)
  })

  it('derives boundaries from legacy poker/hand-start events', () => {
    const events = [
      rawEvent('poker', 'poker/match-start', {}),
      rawEvent('poker', 'poker/hand-start', { handNumber: 1 }),
      rawEvent('poker', 'poker/hand-start', { handNumber: 2 }),
    ]
    expect(computeReplayBoundaries(events).map((boundary) => boundary.label)).toEqual(['第 1 手', '第 2 手'])
  })

  it('navigation: active/next/prev over a fixed boundary list', () => {
    const boundaries: ReplayBoundary[] = [
      { seekIndex: 5, label: '第 1 手', kind: 'hand', value: 1 },
      { seekIndex: 20, label: '第 2 手', kind: 'hand', value: 2 },
      { seekIndex: 40, label: '第 3 手', kind: 'hand', value: 3 },
    ]
    expect(activeBoundaryIndex(boundaries, 0)).toBe(-1)
    expect(activeBoundaryIndex(boundaries, 5)).toBe(0)
    expect(activeBoundaryIndex(boundaries, 21)).toBe(1)
    expect(activeBoundaryIndex(boundaries, 999)).toBe(2)

    expect(nextBoundary(boundaries, 0)?.seekIndex).toBe(5)
    expect(nextBoundary(boundaries, 22)?.seekIndex).toBe(40)
    expect(nextBoundary(boundaries, 40)).toBeNull()

    expect(prevBoundary(boundaries, 4)).toBeNull()
    expect(prevBoundary(boundaries, 5)).toBeNull() // 恰在边界上 → 回退到更早一个
    expect(prevBoundary(boundaries, 6)?.seekIndex).toBe(5)
    expect(prevBoundary(boundaries, 50)?.seekIndex).toBe(40)
  })
})

describe('replay-boundaries — 狼人杀（昼夜轮次）', () => {
  it('creates day/night boundaries from phaseEntered transitions', () => {
    const boundaries = computeReplayBoundaries(werewolfEvents)
    expect(boundaries.length).toBeGreaterThanOrEqual(2)
    expect(boundaries.every((boundary) => boundary.kind === 'phase')).toBe(true)
    // 脚本：夜 1（day=0 → 第 1 夜）→ 昼 1（day=1 → 第 1 天）→ 终局。
    expect(boundaries[0].label).toBe('第 1 夜')
    expect(boundaries[boundaries.length - 1].label).toBe('第 1 天')
    // seekIndex 单调且落在事件范围内。
    for (const [index, boundary] of boundaries.entries()) {
      expect(boundary.seekIndex).toBeGreaterThan(0)
      expect(boundary.seekIndex).toBeLessThanOrEqual(werewolfEvents.length)
      if (index > 0) expect(boundary.seekIndex).toBeGreaterThan(boundaries[index - 1].seekIndex)
    }
  })

  it('each boundary points at a phaseEntered event with that day/night phase', () => {
    const boundaries = computeReplayBoundaries(werewolfEvents)
    for (const boundary of boundaries) {
      const event = werewolfEvents[boundary.seekIndex - 1]
      expect(event.kind).toBe('werewolf:v2:phaseEntered')
      const inner = event.payload.payload as { phase?: string }
      expect(typeof inner.phase).toBe('string')
      expect(['day', 'night']).toContain(String(inner.phase).split(/[./]/)[0])
    }
  })

  it('derives boundaries from legacy moderator-narrate day changes', () => {
    const events = [
      rawEvent('werewolf', 'werewolf/moderator-narrate', { day: 1, upcomingPhase: 'day', narration: '第 1 天' }),
      rawEvent('werewolf', 'werewolf/moderator-narrate', { day: 1, upcomingPhase: 'night', narration: '入夜' }),
      rawEvent('werewolf', 'werewolf/moderator-narrate', { day: 2, upcomingPhase: 'day', narration: '第 2 天' }),
      // 同日重复宣告不产生新边界。
      rawEvent('werewolf', 'werewolf/moderator-narrate', { day: 2, upcomingPhase: 'night', narration: '入夜' }),
    ]
    expect(computeReplayBoundaries(events).map((boundary) => boundary.label)).toEqual(['第 1 天', '第 2 天'])
  })
})

describe('replay-boundaries — 探测与兜底', () => {
  it('detects the game from v2 prefixes and legacy kinds', () => {
    expect(detectGameOfEvents(pokerEvents)).toBe('poker')
    expect(detectGameOfEvents(werewolfEvents)).toBe('werewolf')
    expect(detectGameOfEvents([rawEvent('poker', 'poker/state', {})])).toBe('poker')
    expect(detectGameOfEvents([rawEvent('werewolf', 'werewolf/speak', {})])).toBe('werewolf')
  })

  it('returns no boundaries for unknown / empty streams', () => {
    expect(computeReplayBoundaries([])).toEqual([])
    expect(computeReplayBoundaries([rawEvent('poker', 'poker/match-start', {})])).toEqual([])
  })
})
