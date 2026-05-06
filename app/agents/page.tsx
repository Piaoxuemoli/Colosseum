import { eq } from 'drizzle-orm'
import { AgentForm } from '@/components/forms/AgentForm'
import { AgentRowActions } from '@/components/forms/AgentRowActions'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { db } from '@/lib/db/client'
import { agents, apiProfiles } from '@/lib/db/schema.sqlite'

export const dynamic = 'force-dynamic'

export default async function AgentsPage() {
  const rows = await db
    .select({
      id: agents.id,
      displayName: agents.displayName,
      gameType: agents.gameType,
      kind: agents.kind,
      avatarEmoji: agents.avatarEmoji,
      systemPrompt: agents.systemPrompt,
      profileName: apiProfiles.displayName,
      profileModel: apiProfiles.model,
    })
    .from(agents)
    .leftJoin(apiProfiles, eq(agents.profileId, apiProfiles.id))

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-cyan-300">Roster</p>
          <h1 className="mt-3 text-4xl font-black tracking-tight text-white">Agents</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
            为每位参赛者绑定 Profile、人设 Prompt 和头像。Phase 1B 先支持德州扑克玩家。
          </p>
        </div>
        <AgentForm gameType="poker" />
      </div>

      {rows.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="p-8 text-sm text-muted-foreground">
            暂无 Agent。先去 Profiles 页创建 API Profile，再回来添加 6 位德扑选手。
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {rows.map((agent) => (
            <Card key={agent.id}>
              <CardContent className="flex items-start gap-3 p-4">
                <div className="text-3xl">{agent.avatarEmoji ?? '🃏'}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="font-semibold text-white">{agent.displayName}</div>
                    <Badge variant="outline">{agent.gameType}</Badge>
                    {agent.kind !== 'player' ? <Badge variant="secondary">{agent.kind}</Badge> : null}
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {agent.profileName ?? '(profile 缺失)'} · {agent.profileModel ?? '-'}
                  </div>
                  <p className="mt-2 line-clamp-3 text-xs leading-5 text-muted-foreground">{agent.systemPrompt}</p>
                </div>
                <AgentRowActions agentId={agent.id} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
