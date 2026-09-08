// FR-4.6-04 历史过滤检索：URL 参数解析（parseMatchListFilter）与行过滤
// 谓词（matchListRowMatches）的纯函数层——API route / 大厅页 / SQL 侧共用。

import { describe, expect, it } from 'vitest'
import {
  MatchListFilterError,
  matchListRowMatches,
  parseMatchListFilter,
} from '@/backend/match/list-matches-filtered'

describe('parseMatchListFilter — URL 参数映射', () => {
  it('parses valid params', () => {
    expect(
      parseMatchListFilter({ gameType: 'poker', status: 'completed', q: ' alice ', limit: '20' }),
    ).toEqual({ gameType: 'poker', status: 'completed', q: 'alice', limit: 20 })
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
