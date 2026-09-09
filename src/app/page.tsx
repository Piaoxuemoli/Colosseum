import Link from 'next/link'
import { Suspense } from 'react'
import { count, eq } from 'drizzle-orm'
import { Badge } from '@/frontend/components/ui/badge'
import { Button } from '@/frontend/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/frontend/components/ui/card'
import { Empty } from '@/frontend/components/Empty'
import { MatchCardActions } from '@/frontend/components/match/MatchCardActions'
import { MatchHistoryFilterBar } from '@/frontend/components/match/MatchHistoryFilterBar'
import { PendingLink } from '@/frontend/components/navigation/PendingLink'
import { gameLabel, phaseProgressText } from '@/frontend/lib/game-labels'
import {
  listMatchesFiltered,
  parseMatchListFilter,
  type MatchListFilter,
  type MatchListItem,
} from '@/backend/match/list-matches-filtered'
import { agents, apiProfiles } from '@/platform/db/schema.sqlite'
import { db } from '@/platform/db/client'

export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// 快速开始状态感知（lobby PRD 2.3 状态矩阵；服务端只判数量，key 健康由
// 组局表单内的 KeyGatePanel 承接）
// ---------------------------------------------------------------------------

type QuickStartState = 'S0' | 'S1' | 'S2-partial' | 'S2'

async function detectQuickStart(): Promise<{ state: QuickStartState; profileCount: number; playerAgentCount: number }> {
  const [profileRow] = await db.select({ value: count() }).from(apiProfiles)
  const [agentRow] = await db.select({ value: count() }).from(agents).where(eq(agents.kind, 'player'))
  const profileCount = profileRow?.value ?? 0
  const playerAgentCount = agentRow?.value ?? 0
  if (profileCount === 0) return { state: 'S0', profileCount, playerAgentCount }
  if (playerAgentCount === 0) return { state: 'S1', profileCount, playerAgentCount }
  // 最小板子 5 人（阿瓦隆基础板）：不足时提示缺口但保留入口。
  if (playerAgentCount < 5) return { state: 'S2-partial', profileCount, playerAgentCount }
  return { state: 'S2', profileCount, playerAgentCount }
}

function QuickStart({ state, playerAgentCount }: { state: QuickStartState; playerAgentCount: number }) {
  switch (state) {
    case 'S0':
      return (
        <Card className="border-cyan-300/25 bg-cyan-300/[0.06]">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">快速开始</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>参赛 Agent 依赖模型接入——先配置一个 LLM Profile（API Key 只存在你的浏览器里）。</p>
            <div className="flex flex-wrap gap-3">
              <Button asChild>
                <PendingLink href="/profiles">先配置模型 Key</PendingLink>
              </Button>
              <Button asChild variant="outline">
                <PendingLink href="/matches/new">创建对局</PendingLink>
              </Button>
            </div>
          </CardContent>
        </Card>
      )
    case 'S1':
      return (
        <Card className="border-cyan-300/25 bg-cyan-300/[0.06]">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">快速开始</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>已有模型 Profile。下一步从预置人设模板创建参赛 Agent，零创作起步。</p>
            <div className="flex flex-wrap gap-3">
              <Button asChild>
                <PendingLink href="/agents">从模板创建 Agent</PendingLink>
              </Button>
              <Button asChild variant="outline">
                <PendingLink href="/matches/new">创建对局</PendingLink>
              </Button>
            </div>
          </CardContent>
        </Card>
      )
    case 'S2-partial':
      return (
        <Card className="border-amber-400/25 bg-amber-400/[0.05]">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">快速开始</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p className="text-amber-200">
              当前只有 {playerAgentCount} 个玩家 Agent——最小板子（阿瓦隆 5 人）还差 {Math.max(0, 5 - playerAgentCount)} 名，可先去补齐再开局。
            </p>
            <div className="flex flex-wrap gap-3">
              <Button asChild>
                <PendingLink href="/matches/new">创建对局</PendingLink>
              </Button>
              <Button asChild variant="outline">
                <PendingLink href="/agents">补齐 Agent</PendingLink>
              </Button>
            </div>
          </CardContent>
        </Card>
      )
    default:
      return (
        <Card className="border-cyan-300/25 bg-cyan-300/[0.06]">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">快速开始</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>三桌就绪：德州扑克（6 人）· 狼人杀（6 人 + 主持人）· 阿瓦隆（5–10 人 + 刺杀环节）。</p>
            <Button asChild size="lg">
              <PendingLink href="/matches/new">创建对局</PendingLink>
            </Button>
          </CardContent>
        </Card>
      )
  }
}

// ---------------------------------------------------------------------------
// 直播区（lobby PRD 2.2：六要素卡片）
// ---------------------------------------------------------------------------

function LiveSection({ items }: { items: MatchListItem[] }) {
  if (items.length === 0) {
    return (
      <Empty
        title="现在没有进行中的对局"
        description="创建一局，观看 AI 们如何思考、发言、互相博弈。"
        cta={{
          node: (
            <Button asChild size="sm">
              <PendingLink href="/matches/new">创建对局</PendingLink>
            </Button>
          ),
        }}
      />
    )
  }
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {items.map(({ match, participants, phaseSummary }) => (
        <Card
          key={match.id}
          className="flex h-full flex-col transition duration-150 ease-out hover:border-cyan-300/40 hover:bg-cyan-300/5"
        >
          <CardHeader className="flex flex-row items-start justify-between pb-2">
            <div>
              <Link href={`/matches/${match.id}`} className="text-base font-semibold text-white hover:text-cyan-200">
                {gameLabel(match.gameType)}
              </Link>
              <div className="mt-1 flex items-center gap-2 font-mono text-xs text-cyan-100/70">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                </span>
                {phaseProgressText(match.gameType, phaseSummary) ?? '进行中'}
              </div>
            </div>
            <Badge>直播中</Badge>
          </CardHeader>
          <CardContent className="flex-1 space-y-2 text-sm text-muted-foreground">
            {participants.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                {participants.map((participant) => (
                  <span
                    key={participant.agentId}
                    className="inline-flex max-w-[9rem] items-center gap-1 rounded border border-white/10 bg-white/[0.03] px-1.5 py-0.5 text-xs"
                    title={participant.displayName ?? participant.agentId}
                  >
                    <span>{participant.avatarEmoji ?? '🤖'}</span>
                    <span className="truncate">{participant.displayName ?? participant.agentId}</span>
                  </span>
                ))}
              </div>
            ) : null}
          </CardContent>
          <div className="flex items-center justify-end border-t border-white/5 px-6 py-3">
            <Button asChild size="sm" className="h-7 text-xs">
              <Link href={`/matches/${match.id}`}>进入观战</Link>
            </Button>
          </div>
        </Card>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 最近对局区
// ---------------------------------------------------------------------------

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
      <Empty title="没有匹配的对局" description="当前过滤条件下暂无对局，调整品类 / 状态 / 关键词后再试。" />
    ) : (
      <Empty
        title="还没有已结束的对局"
        description="三桌任选：6 人德扑 · 6 人狼人杀 · 5–10 人阿瓦隆。终局后这里沉淀排名与回放入口。"
      />
    )
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {items.map((item) => {
        const { match, participants } = item
        const settled =
          match.status === 'completed' || match.status === 'errored' || match.status === 'aborted_by_errors'
        const duration = formatDuration(match.startedAt, match.completedAt)
        const summary = settled ? rankingSummary(item) : null
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
                  {gameLabel(match.gameType)}
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

// ---------------------------------------------------------------------------
// 页面（五区：顶部 → 直播 → 快速开始 → 最近对局 → 次级导航）
// ---------------------------------------------------------------------------

export default async function Lobby({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const { filter, invalid } = filterFromSearchParams(params)
  const items = await listMatchesFiltered({ ...filter, limit: 20 })
  const quickStart = await detectQuickStart()

  const running = items.filter((item) => item.match.status === 'running')
  const recent = items.filter((item) => item.match.status !== 'running')

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      {/* 2.1 顶部区域：平台识别 + 全局状态 */}
      <div className="mb-8 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-cyan-300">AI Agent Arena</p>
          <h1 className="mt-3 text-4xl font-black tracking-tight text-white">Colosseum</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
            配置 LLM 选手，看 AI 如何思考、发言与博弈——德扑的概率、狼人杀的伪装、阿瓦隆的刺杀。
          </p>
        </div>
        <Link
          href="#live"
          className="flex items-baseline gap-2 self-end rounded-lg border border-white/10 bg-white/[0.03] px-4 py-2 transition hover:border-cyan-300/30"
        >
          <span className="font-mono text-3xl font-black text-cyan-200">{running.length}</span>
          <span className="text-xs text-muted-foreground">场对局直播中 →</span>
        </Link>
      </div>

      {/* 2.2 正在直播区 */}
      <section id="live" className="scroll-mt-6">
        <div className="mb-4 flex items-center gap-3">
          <h2 className="text-xl font-semibold text-white">正在直播</h2>
          <Badge variant="secondary" className="font-mono">{running.length}</Badge>
        </div>
        <LiveSection items={running} />
      </section>

      {/* 2.3 快速开始区（状态感知） */}
      <section className="mt-10">
        <QuickStart state={quickStart.state} playerAgentCount={quickStart.playerAgentCount} />
      </section>

      {/* 2.4 最近对局区 */}
      <section className="mt-10" id="recent">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-white">最近对局</h2>
        </div>

        {/* FR-4.6-04 过滤检索条：URL 状态同步（?gameType=&status=&q=）。 */}
        <Suspense fallback={null}>
          <MatchHistoryFilterBar />
        </Suspense>
        {invalid ? (
          <div className="mb-4 rounded-lg border border-amber-400/25 bg-amber-400/[0.08] px-3 py-2 text-xs text-amber-200">
            部分过滤参数不合法，已忽略——品类支持 poker / werewolf / avalon。
          </div>
        ) : null}

        <RecentMatches items={recent} hasFilter={Boolean(filter.gameType || filter.status || filter.q)} />
      </section>

      {/* 2.5 次级导航区（弱化管理入口） */}
      <footer className="mt-12 flex flex-wrap items-center gap-5 border-t border-white/5 pt-5 text-sm">
        <span className="text-xs uppercase tracking-[0.25em] text-muted-foreground">管理</span>
        <PendingLink className="text-cyan-200 transition hover:text-cyan-100" href="/profiles">
          模型 Profiles
        </PendingLink>
        <PendingLink className="text-cyan-200 transition hover:text-cyan-100" href="/agents">
          Agents
        </PendingLink>
        <PendingLink className="text-cyan-200 transition hover:text-cyan-100" href="/stats">
          统计与用量
        </PendingLink>
      </footer>
    </div>
  )
}
