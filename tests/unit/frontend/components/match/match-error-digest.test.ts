// FR-4.8-01/02 异常与兜底摘要聚合（aggregateAgentErrors 纯函数）：
// errors API 记录按选手 × 错误类别计数、layer=fallback 计数、
// v2 事件流 isDefault 标记计数。

import { describe, expect, it } from 'vitest'
import { aggregateAgentErrors } from '@/frontend/lib/agent-error-digest'
import { rawEvent } from '../../store/projections/helpers'

const errors = [
  { id: 'e1', agentId: 'a1', agentName: 'Alice', layer: 'parse', errorCode: 'llm-parse_fail', occurredAt: '2026-09-08T00:00:00Z' },
  { id: 'e2', agentId: 'a1', agentName: 'Alice', layer: 'parse', errorCode: 'llm-parse_fail', occurredAt: '2026-09-08T00:01:00Z' },
  { id: 'e3', agentId: 'a1', agentName: 'Alice', layer: 'fallback', errorCode: 'agent-no-action', occurredAt: '2026-09-08T00:02:00Z' },
  { id: 'e4', agentId: 'a2', agentName: 'Bob', layer: 'http', errorCode: 'llm-api_error', occurredAt: '2026-09-08T00:03:00Z' },
]

describe('aggregateAgentErrors', () => {
  it('groups error counts per agent and error class', () => {
    const summary = aggregateAgentErrors(errors, [])
    expect(summary.total).toBe(4)
    const alice = summary.byAgent.find((agent) => agent.agentId === 'a1')
    expect(alice?.codes).toContainEqual({ code: 'llm-parse_fail', title: 'LLM 输出解析失败', count: 2 })
    expect(alice?.codes).toContainEqual({ code: 'agent-no-action', title: 'Agent 未返回动作', count: 1 })
    const bob = summary.byAgent.find((agent) => agent.agentId === 'a2')
    expect(bob?.codes).toEqual([{ code: 'llm-api_error', title: 'LLM 接口调用失败', count: 1 }])
  })

  it('counts fallback-layer records separately', () => {
    expect(aggregateAgentErrors(errors, []).fallbackCount).toBe(1)
    expect(aggregateAgentErrors([], []).fallbackCount).toBe(0)
  })

  it('counts v2 events carrying the isDefault marker (fallback actions in-stream)', () => {
    const events = [
      rawEvent('werewolf', 'werewolf:v2:speech', { playerId: 'a1', content: 'x', isDefault: true }),
      rawEvent('werewolf', 'werewolf:v2:speech', { playerId: 'a2', content: 'y' }),
      rawEvent('werewolf', 'werewolf:v2:voteCast', { voterId: 'a1', targetId: 'a2', isDefault: true }),
      // 非 v2 信封（legacy kind）即使带同名字段也不计——标记属于 v2 契约。
      rawEvent('werewolf', 'werewolf/speak', { content: 'legacy', isDefault: true }),
    ]
    expect(aggregateAgentErrors([], events).defaultActionCount).toBe(2)
  })

  it('empty inputs produce a zeroed summary', () => {
    expect(aggregateAgentErrors([], [])).toEqual({ total: 0, byAgent: [], fallbackCount: 0, defaultActionCount: 0 })
  })

  it('unknown error codes fall back to the raw code as title', () => {
    const summary = aggregateAgentErrors(
      [{ id: 'e9', agentId: 'a1', agentName: 'Alice', layer: 'validate', errorCode: 'weird-code', occurredAt: '2026-09-08T00:00:00Z' }],
      [],
    )
    expect(summary.byAgent[0]?.codes).toEqual([{ code: 'weird-code', title: 'weird-code', count: 1 }])
  })
})
