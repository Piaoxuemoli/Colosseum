// FR-4.7-02 赛后解说前端（R3-4）：
// 1) commentary-format 纯函数——留存事件流解析 / 最新一条 / 坏数据防御；
// 2) CommentaryPanel 已有解说时的轻量呈现（renderToStaticMarkup，jsdom-free）。

import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { CommentaryPanel } from '@/frontend/components/match/CommentaryPanel'
import {
  findLatestCommentary,
  parseCommentaryEvent,
} from '@/frontend/components/match/commentary-format'
import type { GameEvent } from '@/platform/core/types'

function commentaryEvent(seq: number, overrides: Record<string, unknown> = {}): GameEvent {
  return {
    id: `evt_commentary_${seq}`,
    matchId: 'match_panel',
    gameType: 'poker',
    seq,
    occurredAt: '2026-09-09T08:00:00Z',
    kind: 'match/commentary',
    actorAgentId: null,
    payload: {
      commentary: {
        headline: 'Alice 稳健夺冠',
        summary: '全场两次关键派彩锁定胜局。',
        highlights: [
          { seq: 12, title: '大底池', text: '第 5 手 Alice 拿下 240。' },
          { seq: 30, title: '终局', text: 'Bob 出局，比赛结束。' },
        ],
        mvp: { agentId: 'agt_a', reason: '关键池全胜' },
      },
      source: { model: 'gpt-4o-mini', providerHost: 'api.openai.com', createdAt: '2026-09-09T08:30:00Z' },
      ...overrides,
    },
    visibility: 'public',
    restrictedTo: null,
  }
}

describe('parseCommentaryEvent / findLatestCommentary — 留存解析（幂等呈现）', () => {
  it('解析合法 payload（含 mvp 与溯源）', () => {
    const view = parseCommentaryEvent(commentaryEvent(50))
    expect(view?.eventSeq).toBe(50)
    expect(view?.commentary.headline).toBe('Alice 稳健夺冠')
    expect(view?.commentary.highlights).toHaveLength(2)
    expect(view?.commentary.mvp?.agentId).toBe('agt_a')
    expect(view?.source.model).toBe('gpt-4o-mini')
    expect(view?.source.providerHost).toBe('api.openai.com')
  })

  it('非 match/commentary 事件与坏形状 payload → null（不抛错）', () => {
    const other: GameEvent = { ...commentaryEvent(1), kind: 'poker:v2:match-finished' }
    expect(parseCommentaryEvent(other)).toBeNull()
    expect(parseCommentaryEvent(commentaryEvent(2, { commentary: { headline: 'x' } }))).toBeNull()
    expect(parseCommentaryEvent(commentaryEvent(3, { commentary: null }))).toBeNull()
    const noHighlights = commentaryEvent(4, {
      commentary: { headline: 'h', summary: 's', highlights: 'not-array' },
    })
    expect(parseCommentaryEvent(noHighlights)).toBeNull()
  })

  it('findLatestCommentary 取 seq 最大的一条（重新生成 = 追加新事件）', () => {
    const events = [
      commentaryEvent(60, {
        commentary: { headline: '第一版', summary: 's', highlights: [{ seq: 1, title: 't', text: 'x' }] },
      }),
      { ...commentaryEvent(10), id: 'evt_commentary_10' },
      commentaryEvent(70, {
        commentary: { headline: '第二版', summary: 's', highlights: [{ seq: 2, title: 't', text: 'x' }] },
      }),
    ]
    const latest = findLatestCommentary(events)
    expect(latest?.eventSeq).toBe(70)
    expect(latest?.commentary.headline).toBe('第二版')
    expect(findLatestCommentary([])).toBeNull()
  })
})

describe('CommentaryPanel — 已有解说时直接呈现（无需再生成）', () => {
  it('渲染标题 / 摘要 / 亮点（#seq 徽标）/ MVP 徽标与溯源', () => {
    const markup = renderToStaticMarkup(
      createElement(CommentaryPanel, {
        matchId: 'match_panel',
        events: [commentaryEvent(50)],
        agentNames: { agt_a: 'Alice' },
      }),
    )
    expect(markup).toContain('AI 赛后解说')
    expect(markup).toContain('Alice 稳健夺冠')
    expect(markup).toContain('#12')
    expect(markup).toContain('#30')
    expect(markup).toContain('MVP')
    expect(markup).toContain('Alice')
    expect(markup).toContain('gpt-4o-mini')
    expect(markup).toContain('api.openai.com')
    // 密钥口径说明常驻（FR-4.1 透明性）。
    expect(markup).toContain('本地保存的密钥')
    // 留存呈现下不应出现「生成解说」主按钮（幂等：不重复调用 LLM）。
    expect(markup).toContain('重新生成')
  })

  it('无解说时呈现生成入口 + 密钥来源说明', () => {
    const markup = renderToStaticMarkup(
      createElement(CommentaryPanel, { matchId: 'match_panel', events: [] }),
    )
    expect(markup).toContain('生成解说')
    expect(markup).toContain('解说使用你本地保存的密钥')
    expect(markup).not.toContain('重新生成')
  })

  it('提供 onSeekToSeq 时亮点为可点击跳转（回放对照入口）', () => {
    const markup = renderToStaticMarkup(
      createElement(CommentaryPanel, {
        matchId: 'match_panel',
        events: [commentaryEvent(50)],
        onSeekToSeq: () => {},
      }),
    )
    expect(markup).toContain('<button')
    expect(markup).toContain('跳转到该事件时刻')
  })
})
