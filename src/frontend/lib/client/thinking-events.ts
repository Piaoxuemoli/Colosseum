// agent/thinking 事件 → thinking-store 条目（live SSE 与回放共用）。
// 提取自 SpectatorView，使回放（FR-4.6-02/03）与实时观战走同一条解析路径。

import type { GameEvent } from '@/platform/core/types'
import type { ThinkingEntry } from '@/frontend/store/thinking-store'

export function thinkingEntryFromEvent(event: GameEvent, displayName: string): ThinkingEntry | null {
  if (event.kind !== 'agent/thinking' || !event.actorAgentId) return null
  const text = typeof event.payload.text === 'string' ? event.payload.text : ''
  const handNumber = typeof event.payload.handNumber === 'number' ? event.payload.handNumber : 0
  // 狼人杀没有「手」概念，GM 持久化 agent/thinking 时 handNumber=0；允许 0 以便
  // 回放/刷新时恢复狼人思考（扑克 handNumber≥1，不受影响）。
  if (text.trim().length === 0 || handNumber < 0) return null
  const at = Date.parse(event.occurredAt)
  return {
    sourceId: event.id,
    agentId: event.actorAgentId,
    displayName,
    handNumber,
    // Werewolf grouping fields (undefined for poker). Read straight from the
    // persisted payload so playback order never affects the day assignment.
    day: typeof event.payload.day === 'number' ? event.payload.day : undefined,
    phase: typeof event.payload.phase === 'string' ? event.payload.phase : undefined,
    text,
    at: Number.isFinite(at) ? at : Date.now(),
  }
}
