'use client'

import type { GameEvent } from '@/platform/core/types'
import { MatchErrorDigest } from './MatchErrorDigest'
import { RankingVerifyBadge } from './RankingVerifyBadge'

/**
 * 结算可信化组合块（R2-4）：排名回推验证（FR-4.6-01）+ 异常/兜底摘要
 * （FR-4.8-01/02）。结算区（RankingPanel / 狼人结算态）与回放
 * （ReplaySummaryPanel 上方）共用同一份呈现。
 */
export function SettlementTrustSection({
  matchId,
  events,
  finalRanking,
}: {
  matchId: string
  events: GameEvent[]
  finalRanking: Record<string, unknown> | null
}) {
  return (
    <section className="mt-4 space-y-2" data-testid="settlement-trust-section">
      <RankingVerifyBadge matchId={matchId} events={events} finalRanking={finalRanking} />
      <MatchErrorDigest matchId={matchId} events={events} />
    </section>
  )
}
