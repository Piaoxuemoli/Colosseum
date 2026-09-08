'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Bot, ShieldAlert } from 'lucide-react'
import { Badge } from '@/frontend/components/ui/badge'
import type { GameEvent } from '@/platform/core/types'
import { aggregateAgentErrors, type AgentErrorRecord, type AgentErrorSummary } from '@/frontend/lib/agent-error-digest'

type ErrorDigest = {
  count: number
  errors: AgentErrorRecord[]
}/**
 * FR-4.8-01/02 异常与兜底可见：结算区与回放共用的「本局异常摘要」——
 * 按选手 × 错误类别的聚合计数（/api/matches/:id/errors）+ 兜底/默认动作
 * 次数（v2 事件 isDefault 标记）。默认折叠，可展开；无异常时整块隐藏。
 */
export function MatchErrorDigest({ matchId, events }: { matchId: string; events: GameEvent[] }) {
  const [digest, setDigest] = useState<ErrorDigest | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(`/api/matches/${matchId}/errors`)
        if (!res.ok) return
        const json = (await res.json()) as ErrorDigest
        if (!cancelled) setDigest(json)
      } catch {
        // 摘要拉取失败保持隐藏（观战主流程不受影响）。
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [matchId])

  const summary: AgentErrorSummary | null = useMemo(
    () => (digest ? aggregateAgentErrors(digest.errors, events) : null),
    [digest, events],
  )
  // errors 列表服务端截断（50 条），总数以 API 返回的 count 为准。
  const total = digest ? Math.max(digest.count, digest.errors.length) : 0

  if (!summary || (total === 0 && summary.defaultActionCount === 0)) return null

  return (
    <details
      className="rounded-lg border border-red-400/25 bg-red-500/[0.06] px-3 py-2"
      data-testid="match-error-digest"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 text-xs">
        <AlertTriangle size={13} className="text-red-300" aria-hidden="true" />
        <span className="font-medium text-red-100">本局异常与兜底</span>
        <Badge variant="destructive" className="h-5 px-1.5 text-[10px]">
          异常 {total} 次
        </Badge>
        {summary.defaultActionCount > 0 ? (
          <Badge variant="outline" className="h-5 border-red-300/30 px-1.5 text-[10px] text-red-200">
            默认动作 {summary.defaultActionCount} 次
          </Badge>
        ) : null}
        <span className="ml-auto text-[10px] text-muted-foreground">展开明细</span>
      </summary>

      <div className="mt-2 space-y-1.5 text-xs">
        {summary.byAgent.map((agent) => (
          <div
            key={agent.agentId}
            className="flex flex-wrap items-center gap-2 rounded-md border border-white/10 bg-slate-950/60 px-2 py-1.5"
          >
            <span className="inline-flex items-center gap-1 font-medium text-slate-100">
              <Bot size={12} className="text-cyan-200" aria-hidden="true" />
              {agent.agentName}
            </span>
            {agent.codes.map((code) => (
              <span
                key={code.code}
                title={code.code}
                className="rounded-full border border-red-300/20 bg-red-950/40 px-2 py-0.5 text-[10px] text-red-200"
              >
                {code.title} ×{code.count}
              </span>
            ))}
          </div>
        ))}
        {summary.byAgent.length === 0 && summary.defaultActionCount > 0 ? (
          <div className="text-[11px] text-muted-foreground">无按选手的明细（仅默认动作标记）。</div>
        ) : null}
        {summary.fallbackCount > 0 ? (
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <ShieldAlert size={12} className="text-amber-300" aria-hidden="true" />
            其中兜底接管记录 {summary.fallbackCount} 条
          </div>
        ) : null}
        {summary.defaultActionCount > 0 ? (
          <div className="text-[11px] text-muted-foreground">
            事件流 isDefault 标记 {summary.defaultActionCount} 条（LLM 未产出时按规则默认动作推进）。
          </div>
        ) : null}
      </div>
    </details>
  )
}
