import { desc } from 'drizzle-orm'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { db } from '@/lib/db/client'
import { matches } from '@/lib/db/schema.sqlite'

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
          <Link href="/matches/new">开始新对局</Link>
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
          <Link className="text-sm text-cyan-200 hover:text-cyan-100" href="/agents">
            管理 Agents
          </Link>
        </div>

        {rows.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="p-8 text-sm text-muted-foreground">
              暂无对局。先创建 API Profile 和 Agent，然后启动一桌 6 人德扑比赛。
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {rows.map((match) => {
              const settled =
                match.status === 'completed' ||
                match.status === 'errored' ||
                match.status === 'aborted_by_errors'
              return (
                <div key={match.id} className="relative">
                  <Link href={`/matches/${match.id}`} className="block">
                    <Card className="h-full transition hover:border-cyan-300/40 hover:bg-cyan-300/5">
                      <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-base">
                          {match.gameType === 'poker' ? '德州扑克' : '狼人杀'}
                        </CardTitle>
                        <Badge variant={statusBadgeVariant(match.status)}>{match.status}</Badge>
                      </CardHeader>
                      <CardContent className="space-y-2 text-sm text-muted-foreground">
                        <div>开始：{new Date(match.startedAt).toLocaleString('zh-CN')}</div>
                        {match.completedAt ? (
                          <div>结束：{new Date(match.completedAt).toLocaleString('zh-CN')}</div>
                        ) : null}
                        <div className="font-mono text-xs text-cyan-100/70">{match.id}</div>
                      </CardContent>
                    </Card>
                  </Link>
                  {settled ? (
                    <Link
                      href={`/matches/${match.id}/replay`}
                      className="absolute bottom-3 right-3 rounded-md border border-emerald-400/40 bg-emerald-400/10 px-2 py-1 text-xs font-semibold text-emerald-200 hover:bg-emerald-400/20"
                    >
                      回放 →
                    </Link>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
