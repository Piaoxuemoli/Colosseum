import { desc } from 'drizzle-orm'
import Link from 'next/link'
import { Badge } from '@/frontend/components/ui/badge'
import { Button } from '@/frontend/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/frontend/components/ui/card'
import { Empty } from '@/frontend/components/Empty'
import { MatchCardActions } from '@/frontend/components/match/MatchCardActions'
import { PendingLink } from '@/frontend/components/navigation/PendingLink'
import { db } from '@/platform/db/client'
import { matches } from '@/platform/db/schema.sqlite'

export const dynamic = 'force-dynamic'

function statusBadgeVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'running') return 'default'
  if (status === 'completed') return 'secondary'
  if (status === 'errored' || status === 'aborted_by_errors') return 'destructive'
  return 'outline'
}

export default async function Lobby() {
  const rows = await db.select().from(matches).orderBy(desc(matches.startedAt)).limit(20)

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
          <CardContent className="text-3xl font-black">{rows.filter((row) => row.status === 'running').length}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>已完成</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-black">{rows.filter((row) => row.status === 'completed').length}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>最近记录</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-black">{rows.length}</CardContent>
        </Card>
      </section>

      <section className="mt-10">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-white">最近对局</h2>
          <PendingLink className="text-sm text-cyan-200 transition hover:text-cyan-100 active:text-cyan-50" href="/agents">
            管理 Agents
          </PendingLink>
        </div>

        {rows.length === 0 ? (
          <Empty
            title="暂无对局"
            description="先创建 API Profile 和 Agent，然后启动一桌 6 人德扑或一局 9 人狼人杀。"
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {rows.map((match) => {
              const settled =
                match.status === 'completed' ||
                match.status === 'errored' ||
                match.status === 'aborted_by_errors'
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
                      <div>结束：{new Date(match.completedAt).toLocaleString('zh-CN')}</div>
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
        )}
      </section>
    </div>
  )
}
