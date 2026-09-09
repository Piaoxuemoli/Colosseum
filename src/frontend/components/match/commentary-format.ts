// FR-4.7-02 赛后解说（R3-4）前端纯函数层：从留存事件流解析最新一条
// `match/commentary` 事件（与后端 src/backend/match/commentary.ts 的
// payload 契约保持结构一致；前端不 import backend 模块——见
// docs/rules/frontend-backend.md 的 import 约束）。

import type { GameEvent } from '@/platform/core/types'

export const COMMENTARY_EVENT_KIND = 'match/commentary'

export type CommentaryHighlight = {
  seq: number
  title: string
  text: string
}

export type CommentaryMvp = {
  agentId: string
  reason: string
}

export type CommentaryPayload = {
  headline: string
  summary: string
  highlights: CommentaryHighlight[]
  mvp?: CommentaryMvp
}

/** match/commentary 事件 payload 的防御性读取形态。 */
export type CommentaryView = {
  /** 留存事件的 seq（回放跳转定位用，非 highlight 引用）。 */
  eventSeq: number
  commentary: CommentaryPayload
  source: {
    model: string
    providerHost: string
    createdAt: string
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function stringOr(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** 解析单个 match/commentary 事件 payload；形状不符返回 null（不抛错）。 */
export function parseCommentaryEvent(event: GameEvent): CommentaryView | null {
  if (event.kind !== COMMENTARY_EVENT_KIND) return null
  const payload = asRecord(event.payload)
  if (!payload) return null
  const commentaryRaw = asRecord(payload.commentary)
  if (!commentaryRaw) return null

  const headline = stringOr(commentaryRaw.headline)
  const summary = stringOr(commentaryRaw.summary)
  if (!headline || !summary) return null

  const highlights = (Array.isArray(commentaryRaw.highlights) ? commentaryRaw.highlights : []).flatMap(
    (item) => {
      const record = asRecord(item)
      if (!record) return []
      const seq = typeof record.seq === 'number' && Number.isInteger(record.seq) ? record.seq : null
      const title = stringOr(record.title)
      const text = stringOr(record.text)
      if (seq === null || !title || !text) return []
      return [{ seq, title, text }]
    },
  )
  if (highlights.length === 0) return null

  const mvpRaw = asRecord(commentaryRaw.mvp)
  const mvpAgentId = mvpRaw ? stringOr(mvpRaw.agentId) : null
  const mvpReason = mvpRaw ? stringOr(mvpRaw.reason) : null
  const mvp: CommentaryMvp | undefined =
    mvpAgentId && mvpReason ? { agentId: mvpAgentId, reason: mvpReason } : undefined

  const sourceRaw = asRecord(payload.source)
  const source = {
    model: sourceRaw ? stringOr(sourceRaw.model) ?? 'unknown model' : 'unknown model',
    providerHost: sourceRaw ? stringOr(sourceRaw.providerHost) ?? '' : '',
    createdAt: sourceRaw ? stringOr(sourceRaw.createdAt) ?? event.occurredAt : event.occurredAt,
  }

  return {
    eventSeq: event.seq,
    commentary: mvp ? { headline, summary, highlights, mvp } : { headline, summary, highlights },
    source,
  }
}

/**
 * 流中最新一条解说（幂等呈现：重新生成 = 追加新事件，这里取 seq 最大者）。
 * 无解说或全部损坏 → null。
 */
export function findLatestCommentary(events: GameEvent[]): CommentaryView | null {
  let latest: CommentaryView | null = null
  for (const event of events) {
    const view = parseCommentaryEvent(event)
    if (view && (!latest || view.eventSeq > latest.eventSeq)) latest = view
  }
  return latest
}
