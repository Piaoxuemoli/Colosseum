'use client'

import type { GameEvent } from '@/platform/core/types'
import { CommentaryPanel } from './CommentaryPanel'
import { MatchErrorDigest } from './MatchErrorDigest'
import { RankingVerifyBadge } from './RankingVerifyBadge'

/**
 * 结算可信化组合块（R2-4）：排名回推验证（FR-4.6-01）+ 异常/兜底摘要
 * （FR-4.8-01/02）+ 赛后解说（FR-4.7-02，R3-4）。结算区（RankingPanel /
 * 狼人结算态）与回放（ReplayView）共用同一份呈现；解说面板从留存事件流
 * 幂等读取（match/commentary 事件），回放上下文可传入 onSeekToSeq 让
 * 亮点跳转到对应事件时刻。
 */
export function SettlementTrustSection({
  matchId,
  events,
  finalRanking,
  agentNames,
  onSeekToSeq,
}: {
  matchId: string
  events: GameEvent[]
  finalRanking: Record<string, unknown> | null
  /** agentId → 显示名（解说 mvp 徽标用）；回放/结算父组件各自提供。 */
  agentNames?: Record<string, string>
  /** 回放上下文的亮点跳转回调（结算态缺省为不可跳转）。 */
  onSeekToSeq?: (seq: number) => void
}) {
  return (
    <section className="mt-4 space-y-2" data-testid="settlement-trust-section">
      <RankingVerifyBadge matchId={matchId} events={events} finalRanking={finalRanking} />
      <MatchErrorDigest matchId={matchId} events={events} />
      <CommentaryPanel matchId={matchId} events={events} agentNames={agentNames} onSeekToSeq={onSeekToSeq} />
    </section>
  )
}
