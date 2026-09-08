// FR-4.8-01/02 异常与兜底摘要：纯聚合逻辑（errors API 记录 + v2 事件流
// isDefault 标记 → 选手 × 错误类别计数）。与组件解耦，便于单测复用。

import type { GameEvent } from '@/platform/core/types'
import { errorMeta } from '@/frontend/lib/error-catalog'

export type AgentErrorRecord = {
  id: string
  agentId: string
  agentName: string
  layer: string
  errorCode: string
  occurredAt: string
}

export type AgentErrorSummary = {
  total: number
  /** agentName → errorCode → count。 */
  byAgent: Array<{ agentId: string; agentName: string; codes: Array<{ code: string; title: string; count: number }> }>
  /** layer=fallback 的兜底接管次数（agentErrors 表）。 */
  fallbackCount: number
  /** v2 事件流 isDefault 标记的默认动作次数（GM 兜底落流）。 */
  defaultActionCount: number
}

/** 纯聚合：errors API 记录 + 事件流 isDefault 标记 → 选手×错误类别摘要。 */
export function aggregateAgentErrors(errors: AgentErrorRecord[], events: GameEvent[]): AgentErrorSummary {
  const byAgent = new Map<string, { agentId: string; agentName: string; codes: Map<string, number> }>()
  let fallbackCount = 0

  for (const item of errors) {
    const entry =
      byAgent.get(item.agentId) ??
      { agentId: item.agentId, agentName: item.agentName, codes: new Map<string, number>() }
    entry.codes.set(item.errorCode, (entry.codes.get(item.errorCode) ?? 0) + 1)
    byAgent.set(item.agentId, entry)
    if (item.layer === 'fallback') fallbackCount += 1
  }

  let defaultActionCount = 0
  for (const event of events) {
    if (!event.kind.includes(':v2:')) continue
    if (event.payload && typeof event.payload === 'object' && (event.payload as { isDefault?: unknown }).isDefault === true) {
      defaultActionCount += 1
    }
  }

  return {
    total: errors.length,
    byAgent: Array.from(byAgent.values())
      .map((entry) => ({
        agentId: entry.agentId,
        agentName: entry.agentName,
        codes: Array.from(entry.codes.entries())
          .map(([code, count]) => ({ code, title: errorMeta(code).title, count }))
          .sort((a, b) => b.count - a.count),
      }))
      .sort((a, b) => a.agentName.localeCompare(b.agentName)),
    fallbackCount,
    defaultActionCount,
  }
}
