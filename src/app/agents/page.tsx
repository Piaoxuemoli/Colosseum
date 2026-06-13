import { eq } from 'drizzle-orm'
import { AgentForm } from '@/frontend/components/forms/AgentForm'
import { AgentRowActions } from '@/frontend/components/forms/AgentRowActions'
import { AgentsTabs } from '@/frontend/components/forms/AgentsTabs'
import { Badge } from '@/frontend/components/ui/badge'
import { Card, CardContent } from '@/frontend/components/ui/card'
import { Empty } from '@/frontend/components/Empty'
import { db } from '@/platform/db/client'
import { agents, apiProfiles } from '@/platform/db/schema.sqlite'

export const dynamic = 'force-dynamic'

export default async function AgentsPage() {
  const rows = await db
    .select({
      id: agents.id,
      displayName: agents.displayName,
      gameType: agents.gameType,
      kind: agents.kind,
      systemPrompt: agents.systemPrompt,
      profileName: apiProfiles.displayName,
    })
    .from(agents)
    .leftJoin(apiProfiles, eq(agents.profileId, apiProfiles.id))

  const pokerRows = rows.filter((row) => row.gameType === 'poker')
  const werewolfRows = rows.filter((row) => row.gameType === 'werewolf')

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8">
        <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-muted-foreground">Roster</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">Agents</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          为每位参赛者绑定 Profile 和人设 Prompt。支持德扑玩家、狼人杀玩家和狼人杀主持人(moderator)。
        </p>
      </div>

      <AgentsTabs
        pokerCount={pokerRows.length}
        werewolfPlayerCount={werewolfRows.filter((row) => row.kind === 'player').length}
        werewolfModeratorCount={werewolfRows.filter((row) => row.kind === 'moderator').length}
        pokerAgents={<AgentList rows={pokerRows} emptyHint="暂无德扑 Agent。先创建 6 位德扑选手。" />}
        werewolfPlayerAgents={
          <AgentList
            rows={werewolfRows.filter((row) => row.kind === 'player')}
            emptyHint="暂无狼人杀玩家 Agent。需要 6 位。"
          />
        }
        werewolfModeratorAgents={
          <AgentList
            rows={werewolfRows.filter((row) => row.kind === 'moderator')}
            emptyHint="暂无狼人杀主持人(moderator)。至少需要 1 位。"
          />
        }
        newPokerForm={<AgentForm gameType="poker" kind="player" />}
        newWerewolfPlayerForm={<AgentForm gameType="werewolf" kind="player" />}
        newWerewolfModeratorForm={<AgentForm gameType="werewolf" kind="moderator" />}
      />
    </div>
  )
}

type AgentRow = {
  id: string
  displayName: string
  gameType: string
  kind: string
  systemPrompt: string
  profileName: string | null
}

function AgentList({ rows, emptyHint }: { rows: AgentRow[]; emptyHint: string }) {
  if (rows.length === 0) {
    return <Empty title="还没有 Agent" description={emptyHint} />
  }
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {rows.map((agent) => (
        <Card key={agent.id}>
          <CardContent className="flex items-start gap-3 p-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <div className="font-medium text-white">{agent.displayName}</div>
                <Badge variant="outline">{agent.gameType}</Badge>
                {agent.kind !== 'player' ? <Badge variant="secondary">{agent.kind}</Badge> : null}
              </div>
              <div className="mt-1 text-sm text-muted-foreground">{agent.profileName ?? '(profile 缺失)'}</div>
              <p className="mt-2 line-clamp-3 text-xs leading-5 text-muted-foreground">{agent.systemPrompt}</p>
            </div>
            <AgentRowActions agentId={agent.id} />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
