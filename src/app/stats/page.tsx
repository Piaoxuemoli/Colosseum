// FR-4.6-05（R3-5 跨对局统计，观众面）+ FR-4.8-03 / NFR-06（R3-6 用量可见）。
//
// 服务端直连查询层（与大厅一致，不绕 HTTP）；用量面板的分组切换走 URL
// searchParams（?groupBy=agent|purpose|day），非法值静默回退默认分组。

import Link from 'next/link'
import { PendingLink } from '@/frontend/components/navigation/PendingLink'
import { Badge } from '@/frontend/components/ui/badge'
import { Card, CardContent } from '@/frontend/components/ui/card'
import { Empty } from '@/frontend/components/Empty'
import { db } from '@/platform/db/client'
import { getEloLadder, type EloLadderRow } from '@/platform/db/queries/elo'
import {
  getAgentLeaderboard,
  getUsageAggregates,
  parseUsageGroupBy,
  type UsageGroupBy,
} from '@/platform/db/queries/stats'

export const dynamic = 'force-dynamic'

const GAME_TYPE_LABELS: Record<string, string> = { poker: '德扑', werewolf: '狼人杀', avalon: '阿瓦隆' }

const ELO_GAME_OPTIONS = [
  { value: 'poker', label: '德扑' },
  { value: 'werewolf', label: '狼人杀' },
  { value: 'avalon', label: '阿瓦隆' },
] as const

const PURPOSE_LABELS: Record<string, string> = {
  'agent-decision': '决策',
  'moderator-narration': '主持',
  commentary: '解说',
  'profile-test': '配置测试',
}

const GROUP_BY_OPTIONS: Array<{ value: UsageGroupBy; label: string }> = [
  { value: 'agent', label: '按选手' },
  { value: 'purpose', label: '按用途' },
  { value: 'day', label: '按日' },
]

function fmtInt(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('en-US') : '—'
}

function fmtPct(rate: number | null): string {
  return rate === null ? '—' : `${(rate * 100).toFixed(1)}%`
}

function fmtDate(value: Date | null): string {
  return value ? new Date(value).toLocaleDateString('zh-CN') : '—'
}

function safeGroupBy(raw: string | string[] | undefined): UsageGroupBy {
  const value = Array.isArray(raw) ? raw[0] : raw
  try {
    return parseUsageGroupBy(typeof value === 'string' ? value : null)
  } catch {
    return 'agent'
  }
}

function usageGroupKeyLabel(
  row: { key: string | null; agentId: string | null; displayName: string | null },
  groupBy: UsageGroupBy,
): string {
  if (groupBy === 'agent') {
    if (row.agentId === null) return '非选手调用'
    return row.displayName ?? row.agentId
  }
  if (groupBy === 'purpose') return (row.key !== null ? PURPOSE_LABELS[row.key] : null) ?? '—'
  return row.key ?? '—'
}

function safeEloGame(raw: string | string[] | undefined): 'poker' | 'werewolf' | 'avalon' {
  const value = Array.isArray(raw) ? raw[0] : raw
  return value === 'werewolf' || value === 'avalon' ? value : 'poker'
}

function EloLadderTable({ gameType, rows }: { gameType: string; rows: EloLadderRow[] }) {
  if (rows.length === 0) {
    return (
      <Empty
        title={`${GAME_TYPE_LABELS[gameType] ?? gameType} 天梯还没有选手`}
        description="对局完成时自动结算 ELO；历史上已结束的对局可通过重建端点回填（幂等）。"
      />
    )
  }
  return (
    <Card>
      <CardContent className="overflow-x-auto p-0">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-white/10 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-3 font-medium">#</th>
              <th className="px-4 py-3 font-medium">选手</th>
              <th className="px-4 py-3 text-right font-medium">ELO</th>
              <th className="px-4 py-3 text-right font-medium">上次变动</th>
              <th className="px-4 py-3 text-right font-medium">场次</th>
              <th className="px-4 py-3 text-right font-medium">胜 / 负</th>
              <th className="px-4 py-3 text-right font-medium">胜率</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={row.agentId}
                className="border-b border-white/5 transition-colors last:border-b-0 hover:bg-white/[0.03]"
              >
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{index + 1}</td>
                <td className="px-4 py-3">
                  <Link
                    href={`/?q=${encodeURIComponent(row.displayName)}`}
                    className="font-medium text-white hover:text-cyan-200"
                    title={`查看 ${row.displayName} 参与的对局`}
                  >
                    {row.avatarEmoji ? <span className="mr-1.5">{row.avatarEmoji}</span> : null}
                    {row.displayName}
                  </Link>
                </td>
                <td className="px-4 py-3 text-right font-mono text-base font-bold text-cyan-200">{fmtInt(row.rating)}</td>
                <td
                  className={`px-4 py-3 text-right font-mono text-xs ${
                    row.lastDelta > 0 ? 'text-emerald-300' : row.lastDelta < 0 ? 'text-rose-300' : 'text-muted-foreground'
                  }`}
                >
                  {fmtDelta(row.lastDelta)}
                </td>
                <td className="px-4 py-3 text-right font-mono text-cyan-100">{fmtInt(row.matchesPlayed)}</td>
                <td className="px-4 py-3 text-right font-mono text-cyan-100">
                  {fmtInt(row.wins)} / {fmtInt(row.losses)}
                </td>
                <td className="px-4 py-3 text-right font-mono text-cyan-100">
                  {row.matchesPlayed > 0 ? fmtPct(row.wins / row.matchesPlayed) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  )
}

function fmtDelta(delta: number): string {
  if (delta > 0) return `+${delta}`
  return String(delta)
}

export default async function StatsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const groupBy = safeGroupBy(params.groupBy)
  const eloGame = safeEloGame(params.eloGame)

  const [leaderboard, usage, eloLadder] = await Promise.all([
    getAgentLeaderboard(db, {}),
    getUsageAggregates(db, { groupBy }),
    getEloLadder(db, eloGame),
  ])

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.35em] text-cyan-300">Spectator Analytics</p>
        <h1 className="mt-3 text-4xl font-black tracking-tight text-white">统计</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
          跨对局选手排行、ELO 天梯与 LLM 用量汇总——按选手、按用途查看 token 消耗与调用次数。
        </p>
      </div>

      {/* ── FR-4.9-01：ELO 天梯（按品类分列） ───────────────────────────── */}
      <section className="mt-2" id="elo">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-white">ELO 天梯</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              初始 1000 · K=32 · 多人零和两两更新；平局不计分；按品类分列互不换算。
            </p>
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.03] p-1">
            {ELO_GAME_OPTIONS.map((option) => (
              <PendingLink
                key={option.value}
                href={`/stats?eloGame=${option.value}#elo`}
                className={
                  eloGame === option.value
                    ? 'rounded-md border border-cyan-300/25 bg-cyan-300/[0.08] px-3 py-1.5 text-xs font-medium text-cyan-50'
                    : 'rounded-md border border-transparent px-3 py-1.5 text-xs text-slate-300 transition hover:bg-white/[0.05]'
                }
              >
                {option.label}
              </PendingLink>
            ))}
          </div>
        </div>
        <EloLadderTable gameType={eloGame} rows={eloLadder} />
      </section>

      {/* ── FR-4.6-05：选手排行 ─────────────────────────────────────────── */}
      <section className="mt-10" id="leaderboard">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-white">选手排行</h2>
          <span className="text-xs text-muted-foreground">口径：rank 1 或胜方阵营（狼人杀 / 阿瓦隆）</span>
        </div>
        {leaderboard.length === 0 ? (
          <Empty
            title="暂无可统计的对局"
            description="对局结束并完成终局排名后，选手的跨对局战绩会出现在这里。"
          />
        ) : (
          <Card>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full min-w-[860px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-3 font-medium">#</th>
                    <th className="px-4 py-3 font-medium">选手</th>
                    <th className="px-4 py-3 font-medium">品类</th>
                    <th className="px-4 py-3 text-right font-medium">场次</th>
                    <th className="px-4 py-3 text-right font-medium">胜场</th>
                    <th className="px-4 py-3 text-right font-medium">胜率</th>
                    <th className="px-4 py-3 text-right font-medium">平均名次</th>
                    <th className="px-4 py-3 text-right font-medium">最佳名次</th>
                    <th className="px-4 py-3 text-right font-medium">生还</th>
                    <th className="px-4 py-3 text-right font-medium">出局</th>
                    <th className="px-4 py-3 font-medium">最近参战</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.map((row, index) => (
                    <tr
                      key={row.agentId}
                      className="border-b border-white/5 transition-colors last:border-b-0 hover:bg-white/[0.03]"
                    >
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{index + 1}</td>
                      <td className="px-4 py-3">
                        {/* FR-4.6-05 AC：聚合可追溯到来源对局——名字即大厅检索入口。 */}
                        <Link
                          href={`/?q=${encodeURIComponent(row.displayName)}`}
                          className="font-medium text-white hover:text-cyan-200"
                          title={`查看 ${row.displayName} 参与的对局`}
                        >
                          {row.avatarEmoji ? <span className="mr-1.5">{row.avatarEmoji}</span> : null}
                          {row.displayName}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className="text-xs">
                          {GAME_TYPE_LABELS[row.gameType] ?? row.gameType}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-cyan-100">{fmtInt(row.matchesPlayed)}</td>
                      <td className="px-4 py-3 text-right font-mono text-cyan-100">{fmtInt(row.wins)}</td>
                      <td className="px-4 py-3 text-right font-mono text-cyan-100">{fmtPct(row.winRate)}</td>
                      <td className="px-4 py-3 text-right font-mono text-cyan-100">
                        {row.avgRank === null ? '—' : row.avgRank.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-cyan-100">{fmtInt(row.bestRank)}</td>
                      <td className="px-4 py-3 text-right font-mono text-cyan-100">{fmtInt(row.survived)}</td>
                      <td className="px-4 py-3 text-right font-mono text-cyan-100">{fmtInt(row.eliminated)}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{fmtDate(row.lastPlayedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </section>

      {/* ── FR-4.8-03 / NFR-06：LLM 用量 ─────────────────────────────────── */}
      <section className="mt-10" id="usage">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <h2 className="text-xl font-semibold text-white">LLM 用量</h2>
          <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.03] p-1">
            {GROUP_BY_OPTIONS.map((option) => (
              <PendingLink
                key={option.value}
                href={`/stats?groupBy=${option.value}#usage`}
                className={
                  groupBy === option.value
                    ? 'rounded-md border border-cyan-300/25 bg-cyan-300/[0.08] px-3 py-1.5 text-xs font-medium text-cyan-50'
                    : 'rounded-md border border-transparent px-3 py-1.5 text-xs text-slate-300 transition hover:bg-white/[0.05]'
                }
              >
                {option.label}
              </PendingLink>
            ))}
          </div>
        </div>

        {usage.rows.length === 0 ? (
          <Empty
            title="暂无 LLM 调用记录"
            description="对局中的每次 LLM 调用（决策 / 主持 / 解说）都会落一条用量流水；这里展示其聚合。"
          />
        ) : (
          <Card>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full min-w-[720px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-3 font-medium">{groupBy === 'day' ? '日期（UTC）' : groupBy === 'purpose' ? '用途' : '选手'}</th>
                    <th className="px-4 py-3 text-right font-medium">调用次数</th>
                    <th className="px-4 py-3 text-right font-medium">Prompt tokens</th>
                    <th className="px-4 py-3 text-right font-medium">Completion tokens</th>
                    <th className="px-4 py-3 text-right font-medium">总 tokens</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.rows.map((row) => (
                    <tr
                      key={`${groupBy}:${row.key ?? 'none'}`}
                      className="border-b border-white/5 transition-colors last:border-b-0 hover:bg-white/[0.03]"
                    >
                      <td className="px-4 py-3 font-medium text-white">{usageGroupKeyLabel(row, groupBy)}</td>
                      <td className="px-4 py-3 text-right font-mono text-cyan-100">{fmtInt(row.calls)}</td>
                      <td className="px-4 py-3 text-right font-mono text-cyan-100">{fmtInt(row.promptTokens)}</td>
                      <td className="px-4 py-3 text-right font-mono text-cyan-100">{fmtInt(row.completionTokens)}</td>
                      <td className="px-4 py-3 text-right font-mono text-cyan-100">{fmtInt(row.totalTokens)}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-white/10 bg-white/[0.02]">
                    <td className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      总计
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm font-semibold text-white">
                      {fmtInt(usage.totals.calls)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm font-semibold text-white">
                      {fmtInt(usage.totals.promptTokens)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm font-semibold text-white">
                      {fmtInt(usage.totals.completionTokens)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm font-semibold text-white">
                      {fmtInt(usage.totals.totalTokens)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
        <p className="mt-3 text-xs leading-5 text-muted-foreground">
          {usage.totals.knownTokenCalls < usage.totals.calls
            ? `共 ${fmtInt(usage.totals.calls)} 次调用，其中 ${fmtInt(usage.totals.knownTokenCalls)} 次供应方上报了 token 用量——未上报的调用仅计次数（流式响应未携带 usage 时无法计 token）。`
            : '全部调用均有 token 用量上报。'}
        </p>
      </section>
    </div>
  )
}
