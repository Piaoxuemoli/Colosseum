import Link from 'next/link'
import { Suspense } from 'react'
import { Badge } from '@/frontend/components/ui/badge'
import { Button } from '@/frontend/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/frontend/components/ui/card'
import { Empty } from '@/frontend/components/Empty'
import { MatchCardActions } from '@/frontend/components/match/MatchCardActions'
import { MatchHistoryFilterBar } from '@/frontend/components/match/MatchHistoryFilterBar'
import { PendingLink } from '@/frontend/components/navigation/PendingLink'
import {
  listMatchesFiltered,
  parseMatchListFilter,
  type MatchListFilter,
  type MatchListItem,
} from '@/backend/match/list-matches-filtered'

export const dynamic = 'force-dynamic'

function statusBadgeVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'running') return 'default'
  if (status === 'completed') return 'secondary'
  if (status === 'errored' || status === 'aborted_by_errors') return 'destructive'
  return 'outline'
}

function formatDuration(from: Date, to: Date | null): string | null {
  if (!to) return null
  const seconds = Math.max(0, Math.floor((to.getTime() - from.getTime()) / 1000))
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  return `${hours} 小时 ${minutes % 60} 分钟`
}

/** 终局排名摘要（FR-4.6-04）：前 3 名 Agent 名（名次序），无可排名数据时为 null。 */
function rankingSummary(item: MatchListItem): string | null {
  const ranking = item.match.finalRanking
  if (!ranking || typeof ranking !== 'object') return null
  const rows = Array.isArray((ranking as { ranking?: unknown }).ranking)
    ? ((ranking as { ranking: unknown[] }).ranking)
    : []
  const nameById = new Map(item.participants.map((p) => [p.agentId, p.displayName ?? p.agentId]))
  const ordered = rows
    .filter((row): row is { agentId?: unknown; rank?: unknown } => typeof row === 'object' && row !== null)
    .map((row) => ({
      agentId: typeof row.agentId === 'string' ? row.agentId : null,
      rank: typeof row.rank === 'number' ? row.rank : Number.POSITIVE_INFINITY,
    }))
    .filter((row) => row.agentId !== null)
    .sort((a, b) => a.rank - b.rank)
  if (ordered.length === 0) return null
  return ordered
    .slice(0, 3)
    .map((row, index) => `#${index + 1} ${nameById.get(row.agentId as string) ?? row.agentId}`)
    .join(' · ')
}

/** URL 参数（可能含非法值）→ 安全过滤条件：非法参数静默忽略而非 500。 */
function filterFromSearchParams(
  searchParams: Record<string, string | string[] | undefined>,
): { filter: MatchListFilter; invalid: boolean } {
  const pick = (key: string): string | null => {
    const value = searchParams[key]
    const raw = Array.isArray(value) ? value[0] : value
    return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null
  }
  try {
    return {
      filter: parseMatchListFilter({
        gameType: pick('gameType'),
        status: pick('status'),
        q: pick('q'),
      }),
      invalid: false,
    }
  } catch {
    return { filter: {}, invalid: true }
  }
}

function RecentMatches({ items, hasFilter }: { items: MatchListItem[]; hasFilter: boolean }) {
  if (items.length === 0) {
    return hasFilter ? (
      <Empty
        title="没有匹配的对局"
        description="当前过滤条件下暂无对局，调整品类 / 状态 / 关键词后再试。"
      />
    ) : (
      <Empty
        title="暂无对局"
        description="先创建 API Profile 和 Agent，然后启动一桌 6 人德扑或一局 6 人狼人杀。"
      />
    )
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {items.map(({ match, participants }) => {
        const settled =
          match.status === 'completed' || match.status === 'errored' || match.status === 'aborted_by_errors'
        const duration = formatDuration(match.startedAt, match.completedAt)
        const summary = settled ? rankingSummary({ match, participants }) : null
        return (
          <Card
            key={match.id}
            className="flex h-full flex-col transition duration-150 ease-out hover:border-cyan-300/40 hover:bg-cyan-300/5"
          >
            <CardHeader className="flex flex-row items-start justify-between pb-2">
              <div>
                <Link
                  href={`/matches/${match.id}`}
                  className="text-base font-semibold text-white hover:text-cyan-200"
                >
                  {match.gameType === 'poker' ? '德州扑克' : '狼人杀'}
                </Link>
                <div className="mt-1 font-mono text-xs text-cyan-100/70">{match.id}</div>
              </div>
              <Badge variant={statusBadgeVariant(match.status)}>{match.status}</Badge>
            </CardHeader>
            <CardContent className="flex-1 space-y-2 text-sm text-muted-foreground">
              <div>开始：{new Date(match.startedAt).toLocaleString('zh-CN')}</div>
              {match.completedAt ? (
                <div>
                  结束：{new Date(match.completedAt).toLocaleString('zh-CN')}
                  {duration ? <span className="ml-1 text-cyan-100/70">（时长 {duration}）</span> : null}
                </div>
              ) : null}
              {participants.length > 0 ? (
                <div className="truncate text-xs">
                  参赛：{participants.map((p) => p.displayName ?? p.agentId).join('、')}
                </div>
              ) : null}
              {summary ? (
                <div className="truncate font-mono text-xs text-cyan-100/80" title={summary}>
                  {summary}
                </div>
              ) : null}
            </CardContent>
            <div className="flex items-center justify-between border-t border-white/5 px-6 py-3">
              <div className="flex items-center gap-2">
                {settled ? (
                  <Button asChild variant="outline" size="sm" className="h-7 text-xs">
                    <Link href={`/matches/${match.id}/replay`}>回放</Link>
                  </Button>
                ) : (
                  <Button asChild variant="outline" size="sm" className="h-7 text-xs">
                    <Link href={`/matches/${match.id}`}>观战</Link>
                  </Button>
                )}
              </div>
              <MatchCardActions matchId={match.id} status={match.status} />
            </div>
          </Card>
        )
      })}
    </div>
  )
}

export default async function Lobby({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const { filter, invalid } = filterFromSearchParams(params)
  const items = await listMatchesFiltered({ ...filter, limit: 20 })

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-cyan-300">Spectator Lobby</p>
          <h1 className="mt-3 text-4xl font-black tracking-tight text-white">大厅</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
            管理比赛入口、快速查看最近对局，并从这里进入观战或创建新的 AI 牌桌。
          </p>
        </div>
        <Button asChild size="lg">
          <PendingLink href="/matches/new" pendingClassName="opacity-80">
            开始新对局
          </PendingLink>
        </Button>
      </div>

      <section className="grid gap-4 md:grid-cols-3">
        <Card className="border-cyan-300/20 bg-cyan-300/10">
          <CardHeader>
            <CardTitle>运行中</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-black">{items.filter((item) => item.match.status === 'running').length}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>已完成</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-black">{items.filter((item) => item.match.status === 'completed').length}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>最近记录</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-black">{items.length}</CardContent>
        </Card>
      </section>

      <section className="mt-10" id="recent">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-white">最近对局</h2>
          <div className="flex items-center gap-4">
            <PendingLink className="text-sm text-cyan-200 transition hover:text-cyan-100 active:text-cyan-50" href="/agents">
              管理 Agents
            </PendingLink>
            {/* FR-4.6-05 / FR-4.8-03：跨对局统计 + 用量入口。 */}
            <PendingLink className="text-sm text-cyan-200 transition hover:text-cyan-100 active:text-cyan-50" href="/stats">
              统计
            </PendingLink>
          </div>
        </div>

        {/* FR-4.6-04 过滤检索条：URL 状态同步（?gameType=&status=&q=）。 */}
        <Suspense fallback={null}>
          <MatchHistoryFilterBar />
        </Suspense>
        {invalid ? (
          <div className="mb-4 rounded-lg border border-amber-400/25 bg-amber-400/[0.08] px-3 py-2 text-xs text-amber-200">
            部分过滤参数不合法，已忽略——品类仅支持 poker / werewolf。
          </div>
        ) : null}

        <RecentMatches items={items} hasFilter={Boolean(filter.gameType || filter.status || filter.q)} />
      </section>
    </div>
  )
}
