// FR-4.6-04 历史过滤检索：URL 参数解析（parseMatchListFilter）与行过滤
// 谓词（matchListRowMatches）的纯函数层——API route / 大厅页 / SQL 侧共用。

import { describe, expect, it } from 'vitest'
import {
  MatchListFilterError,
  matchListRowMatches,
  parseMatchListFilter,
  phaseSummaryFromEvent,
} from '@/backend/match/list-matches-filtered'

describe('parseMatchListFilter — URL 参数映射', () => {
  it('parses valid params', () => {
    expect(
      parseMatchListFilter({ gameType: 'poker', status: 'completed', q: ' alice ', limit: '20' }),
    ).toEqual({ gameType: 'poker', status: 'completed', q: 'alice', limit: 20 })
  })

  it('accepts every documented gameType (poker / werewolf / avalon)', () => {
    expect(parseMatchListFilter({ gameType: 'avalon' }).gameType).toBe('avalon')
    expect(parseMatchListFilter({ gameType: 'werewolf' }).gameType).toBe('werewolf')
    expect(parseMatchListFilter({ gameType: 'poker' }).gameType).toBe('poker')
  })

  it('treats null / empty / whitespace params as "no filter"', () => {
    expect(parseMatchListFilter({ gameType: null, status: '', q: '   ' })).toEqual({})
    expect(parseMatchListFilter({})).toEqual({})
  })

  it('rejects an invalid gameType', () => {
    expect(() => parseMatchListFilter({ gameType: 'chess' })).toThrow(MatchListFilterError)
  })

  it('rejects an invalid status', () => {
    expect(() => parseMatchListFilter({ status: 'done' })).toThrow(MatchListFilterError)
  })

  it('rejects an out-of-range limit', () => {
    expect(() => parseMatchListFilter({ limit: '0' })).toThrow(MatchListFilterError)
    expect(() => parseMatchListFilter({ limit: '999' })).toThrow(MatchListFilterError)
    expect(() => parseMatchListFilter({ limit: 'abc' })).toThrow(MatchListFilterError)
  })

  it('accepts every documented status value', () => {
    for (const status of ['pending', 'running', 'completed', 'errored', 'aborted_by_errors']) {
      expect(parseMatchListFilter({ status }).status).toBe(status)
    }
  })
})

describe('matchListRowMatches — 行过滤谓词', () => {
  const row = { id: 'mtc_abc123', gameType: 'werewolf', status: 'completed' }

  it('empty filter matches everything', () => {
    expect(matchListRowMatches(row, [], {})).toBe(true)
  })

  it('filters by gameType and status exactly', () => {
    expect(matchListRowMatches(row, ['Alice'], { gameType: 'werewolf' })).toBe(true)
    expect(matchListRowMatches(row, ['Alice'], { gameType: 'poker' })).toBe(false)
    expect(matchListRowMatches(row, ['Alice'], { status: 'completed' })).toBe(true)
    expect(matchListRowMatches(row, ['Alice'], { status: 'running' })).toBe(false)
  })

  it('q matches the match id (case-insensitive substring)', () => {
    expect(matchListRowMatches(row, [], { q: 'mtc_abc' })).toBe(true)
    expect(matchListRowMatches(row, [], { q: 'ABC123' })).toBe(true)
    expect(matchListRowMatches(row, [], { q: 'zzz' })).toBe(false)
  })

  it('q matches participant agent names (case-insensitive substring)', () => {
    expect(matchListRowMatches(row, ['Alice', 'Bob'], { q: 'bob' })).toBe(true)
    expect(matchListRowMatches(row, ['Alice', 'Bob'], { q: 'ALICE' })).toBe(true)
    expect(matchListRowMatches(row, ['Alice', 'Bob'], { q: 'carol' })).toBe(false)
  })

  it('combines all three conditions (AND)', () => {
    expect(
      matchListRowMatches(row, ['Alice'], { gameType: 'werewolf', status: 'completed', q: 'alice' }),
    ).toBe(true)
    expect(
      matchListRowMatches(row, ['Alice'], { gameType: 'werewolf', status: 'completed', q: 'carol' }),
    ).toBe(false)
    expect(
      matchListRowMatches({ ...row, status: 'running' }, ['Alice'], {
        gameType: 'werewolf',
        status: 'completed',
        q: 'alice',
      }),
    ).toBe(false)
  })
})

describe('phaseSummaryFromEvent — 直播卡片阶段摘要（lobby PRD 2.2）', () => {
  it('derives from an avalon/werewolf phaseEntered envelope (day at top level)', () => {
    const event = { seq: 12, day: 3, kind: 'phaseEntered', audience: { kind: 'public' }, actorId: null, payload: { phase: 'teamVote' } }
    expect(phaseSummaryFromEvent('avalon', event)).toEqual({ handNumber: 0, day: 3, phase: 'teamVote' })
  })

  it('derives from a poker hand-started envelope (handNumber in payload)', () => {
    const event = { seq: 40, day: 2, kind: 'hand-started', payload: { handNumber: 2 } }
    expect(phaseSummaryFromEvent('poker', event)).toEqual({ handNumber: 2, day: 2, phase: '' })
  })

  it('accepts a JSON string payload (game_events text column form)', () => {
    const raw = JSON.stringify({ seq: 5, day: 1, kind: 'phaseEntered', payload: { phase: 'night.wolves' } })
    expect(phaseSummaryFromEvent('werewolf', raw)).toEqual({ handNumber: 0, day: 1, phase: 'night.wolves' })
  })

  it('returns null for non-phase events / unparseable input', () => {
    expect(phaseSummaryFromEvent('avalon', { seq: 1, kind: 'statementIssued', payload: { text: 'x' } })).toBeNull()
    expect(phaseSummaryFromEvent('avalon', 'not-json')).toBeNull()
    expect(phaseSummaryFromEvent('avalon', null)).toBeNull()
  })
})
