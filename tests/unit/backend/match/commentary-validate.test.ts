// FR-4.7-02 赛后解说校验器（R3-4）——「不虚构」的强制执行点：
// highlight.seq 必须真实存在于事件流；过半无效整体拒绝；mvp 必须在名册。

import { describe, expect, it } from 'vitest'
import { validateCommentaryResponse } from '@/backend/match/commentary'
import type { GameEvent } from '@/platform/core/types'

function event(seq: number, actorAgentId: string | null = 'agt_a'): GameEvent {
  return {
    id: `evt_${seq}`,
    matchId: 'match_test',
    gameType: 'poker',
    seq,
    occurredAt: '2026-09-09T00:00:00Z',
    kind: 'poker:v2:action-made',
    actorAgentId,
    payload: {},
    visibility: 'public',
    restrictedTo: null,
  }
}

const STREAM = [event(1), event(2), event(3), event(4), event(5)]

function highlight(seq: number, title = '关键时刻', text = '两句以内的解说文本。') {
  return { seq, title, text }
}

describe('validateCommentaryResponse — 形状校验', () => {
  it('接受完整合法输出（含 mvp）', () => {
    const result = validateCommentaryResponse({
      raw: {
        headline: '稳健收官',
        summary: 'Alice 全场压制，终局以筹码优势夺冠。',
        highlights: [highlight(1), highlight(3)],
        mvp: { agentId: 'agt_a', reason: '关键两池全胜' },
      },
      events: STREAM,
      rosterAgentIds: ['agt_a', 'agt_b'],
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.commentary.headline).toBe('稳健收官')
      expect(result.commentary.highlights).toHaveLength(2)
      expect(result.commentary.mvp?.agentId).toBe('agt_a')
      expect(result.droppedHighlights).toBe(0)
    }
  })

  it('拒绝非对象 / 缺 headline / 空 highlights / 缺字段', () => {
    expect(validateCommentaryResponse({ raw: 'text', events: STREAM }).ok).toBe(false)
    expect(validateCommentaryResponse({ raw: null, events: STREAM }).ok).toBe(false)
    expect(
      validateCommentaryResponse({
        raw: { summary: 'x', highlights: [highlight(1)] },
        events: STREAM,
      }).ok,
    ).toBe(false)
    expect(
      validateCommentaryResponse({
        raw: { headline: 'x', summary: 'y', highlights: [] },
        events: STREAM,
      }).ok,
    ).toBe(false)
    expect(
      validateCommentaryResponse({
        raw: { headline: 'x', summary: 'y', highlights: [{ title: 't', text: 'x' }] },
        events: STREAM,
      }).ok,
    ).toBe(false)
  })

  it('超长文本被截断而非拒绝（内容安全上限）', () => {
    const result = validateCommentaryResponse({
      raw: {
        headline: '标'.repeat(500),
        summary: '内'.repeat(5000),
        highlights: [{ seq: 1, title: '题'.repeat(500), text: '文'.repeat(5000) }],
      },
      events: STREAM,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.commentary.headline.length).toBeLessThanOrEqual(120)
      expect(result.commentary.summary.length).toBeLessThanOrEqual(800)
      expect(result.commentary.highlights[0]?.text.length).toBeLessThanOrEqual(400)
    }
  })
})

describe('validateCommentaryResponse — seq grounding（不虚构）', () => {
  it('少数无效 seq 的亮点被丢弃，其余保留', () => {
    const result = validateCommentaryResponse({
      raw: {
        headline: 'h',
        summary: 's',
        highlights: [highlight(2), highlight(999), highlight(4)],
      },
      events: STREAM,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.commentary.highlights.map((h) => h.seq)).toEqual([2, 4])
      expect(result.droppedHighlights).toBe(1)
      expect(result.invalidSeqs).toEqual([999])
    }
  })

  it('恰好一半无效：保留（> 半数才整体拒绝）', () => {
    const result = validateCommentaryResponse({
      raw: { headline: 'h', summary: 's', highlights: [highlight(1), highlight(888)] },
      events: STREAM,
    })
    expect(result.ok).toBe(true)
  })

  it('过半无效 → 整体拒绝并列出 invalidSeqs', () => {
    const result = validateCommentaryResponse({
      raw: {
        headline: 'h',
        summary: 's',
        highlights: [highlight(1), highlight(901), highlight(902), highlight(903)],
      },
      events: STREAM,
    })
    expect(result.ok).toBe(false)
    if (!result.ok && result.code === 'fabrication') {
      expect(result.invalidSeqs).toEqual([901, 902, 903])
      expect(result.kept).toBe(1)
      expect(result.dropped).toBe(3)
    } else {
      throw new Error('expected fabrication rejection')
    }
  })

  it('全部无效 → 整体拒绝', () => {
    const result = validateCommentaryResponse({
      raw: { headline: 'h', summary: 's', highlights: [highlight(700), highlight(701)] },
      events: STREAM,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('fabrication')
  })

  it('stream 中 restricted / private 事件的 seq 同样是合法引用（留存即事实）', () => {
    const fullStream = [
      ...STREAM,
      { ...event(6), visibility: 'role-restricted' as const, restrictedTo: ['delayed-public'] },
    ]
    const result = validateCommentaryResponse({
      raw: { headline: 'h', summary: 's', highlights: [highlight(6)] },
      events: fullStream,
    })
    expect(result.ok).toBe(true)
  })
})

describe('validateCommentaryResponse — mvp 名册约束', () => {
  it('mvp 不在名册 → 丢弃 mvp 但保留解说', () => {
    const result = validateCommentaryResponse({
      raw: {
        headline: 'h',
        summary: 's',
        highlights: [highlight(1)],
        mvp: { agentId: 'agt_ghost', reason: '编造的选手' },
      },
      events: STREAM,
      rosterAgentIds: ['agt_a', 'agt_b'],
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.commentary.mvp).toBeUndefined()
      expect(result.droppedMvp).toBe(true)
    }
  })

  it('未提供名册时从事件 actor 推导合法域', () => {
    const result = validateCommentaryResponse({
      raw: {
        headline: 'h',
        summary: 's',
        highlights: [highlight(1)],
        mvp: { agentId: 'agt_a', reason: '在场选手' },
      },
      events: STREAM,
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.commentary.mvp?.agentId).toBe('agt_a')
  })
})
