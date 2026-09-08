'use client'

import { useEffect, useMemo, useState } from 'react'
import { BadgeCheck, ShieldAlert, ShieldQuestion } from 'lucide-react'
import type { GameEvent } from '@/platform/core/types'
import {
  deriveRankingFromEvents,
  parseDeliveredRanking,
  verifySettlementRanking,
} from '@/frontend/store/projections/ranking-verify'

/**
 * FR-4.6-01 排名可回推：把「事件流独立回推的排名」与「结算交付的排名」
 * （matches.finalRanking）对比——一致显示 ✓ 徽标；不一致列出分歧；
 * 任一侧数据不足显示「无法验证」。绝不把不可验证静默当作通过。
 */
export function RankingVerifyBadge({
  matchId,
  events,
  finalRanking,
}: {
  matchId: string
  events: GameEvent[]
  finalRanking: Record<string, unknown> | null
}) {
  // SSR 快照缺 finalRanking（如 live 结束在 SSE 到达后）时补拉一次对局详情。
  const [fetched, setFetched] = useState<Record<string, unknown> | null>(null)

  useEffect(() => {
    if (finalRanking) return
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(`/api/matches/${matchId}`)
        if (!res.ok) return
        const json = (await res.json()) as { match?: { finalRanking?: Record<string, unknown> | null } }
        if (!cancelled && json.match?.finalRanking) setFetched(json.match.finalRanking)
      } catch {
        // 拉取失败 → 维持「无法验证」呈现，不阻塞结算面板。
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [finalRanking, matchId])

  const verification = useMemo(() => {
    const derived = deriveRankingFromEvents(events)
    const delivered = parseDeliveredRanking(finalRanking ?? fetched)
    return verifySettlementRanking(derived, delivered)
  }, [events, finalRanking, fetched])

  if (verification.status === 'verified') {
    return (
      <div
        className="flex items-center gap-1.5 rounded-lg border border-emerald-400/25 bg-emerald-400/[0.08] px-3 py-2 text-xs text-emerald-200"
        data-testid="ranking-verify-verified"
      >
        <BadgeCheck size={14} aria-hidden="true" />
        排名已由事件流回推验证
      </div>
    )
  }

  if (verification.status === 'underivable') {
    return (
      <div
        className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2 text-xs text-muted-foreground"
        data-testid="ranking-verify-underivable"
      >
        <ShieldQuestion size={14} aria-hidden="true" />
        排名无法回推验证：{verification.reason}
      </div>
    )
  }

  return (
    <div
      className="rounded-lg border border-red-400/30 bg-red-500/[0.08] px-3 py-2 text-xs"
      data-testid="ranking-verify-mismatch"
    >
      <div className="flex items-center gap-1.5 font-medium text-red-100">
        <ShieldAlert size={14} aria-hidden="true" />
        排名与事件流回推不一致（请核查结算数据）
      </div>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[11px] leading-5 text-red-200/90">
        {verification.divergences.map((divergence, index) => (
          <li key={index}>{divergence}</li>
        ))}
      </ul>
    </div>
  )
}
