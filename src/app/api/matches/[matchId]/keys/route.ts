import { asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { getApiKey, putApiKey } from '@/backend/agent/key-cache'
import { db } from '@/platform/db/client'
import { agents, apiProfiles, matchParticipants, matches } from '@/platform/db/schema.sqlite'
import { findAgentById } from '@/platform/db/queries/agents'
import { findProfileById } from '@/platform/db/queries/profiles'
import { redis } from '@/platform/redis/client'
import { keys } from '@/platform/redis/keys'

export const runtime = 'nodejs'

const bodySchema = z.object({
  profileId: z.string().min(1),
  apiKey: z.string().min(1),
})

export async function POST(req: Request, context: { params: Promise<{ matchId: string }> }): Promise<Response> {
  const { matchId } = await context.params
  const json = await req.json().catch(() => null)
  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) {
    return Response.json({ error: 'invalid body', details: parsed.error.flatten() }, { status: 400 })
  }

  await putApiKey(matchId, parsed.data.profileId, parsed.data.apiKey)
  return new Response(null, { status: 204 })
}

export type MatchKeyStatusEntry = {
  profileId: string
  displayName: string
  model: string
  /** 使用该 Profile 的 Agent 显示名（玩家 + 狼人杀主持人）。 */
  agentNames: string[]
  /** 服务端本局 keyring 是否已缓存该 Profile 的 key。 */
  present: boolean
}

/**
 * FR-4.1-03 密钥状态查询：本局需要哪些 Profile key、服务端 keyring 是否已有。
 *
 * 键的真实值永不返回（NFR：密钥不出服务端），只返回存在性布尔。
 * 参赛玩家来自 match_participants；狼人杀主持人只存在于引擎状态
 * （redis matchState.moderatorAgentId），在此补充进来。
 */
export async function GET(_req: Request, context: { params: Promise<{ matchId: string }> }): Promise<Response> {
  const { matchId } = await context.params
  const [match] = await db.select().from(matches).where(eq(matches.id, matchId)).limit(1)
  if (!match) return Response.json({ error: 'match not found' }, { status: 404 })

  const participantRows = await db
    .select({
      agentId: agents.id,
      agentName: agents.displayName,
      profileId: apiProfiles.id,
      profileName: apiProfiles.displayName,
      model: apiProfiles.model,
    })
    .from(matchParticipants)
    .innerJoin(agents, eq(matchParticipants.agentId, agents.id))
    .innerJoin(apiProfiles, eq(agents.profileId, apiProfiles.id))
    .where(eq(matchParticipants.matchId, matchId))
    .orderBy(asc(matchParticipants.seatIndex))

  const grouped = new Map<string, MatchKeyStatusEntry>()
  const addRow = (profileId: string, profileName: string, model: string, agentName: string) => {
    const existing = grouped.get(profileId)
    if (existing) {
      if (!existing.agentNames.includes(agentName)) existing.agentNames.push(agentName)
      return
    }
    grouped.set(profileId, { profileId, displayName: profileName, model, agentNames: [agentName], present: false })
  }
  for (const row of participantRows) addRow(row.profileId, row.profileName, row.model, row.agentName)

  // 狼人杀主持人不是 participant，从引擎状态里补（对局结束后状态已清除，失败即跳过）。
  if (match.gameType === 'werewolf') {
    try {
      const stateRaw = await redis.get(keys.matchState(matchId))
      const moderatorAgentId = stateRaw
        ? (JSON.parse(stateRaw) as { moderatorAgentId?: unknown }).moderatorAgentId
        : undefined
      if (typeof moderatorAgentId === 'string' && moderatorAgentId) {
        const moderatorAgent = await findAgentById(moderatorAgentId)
        const moderatorProfile = moderatorAgent ? await findProfileById(moderatorAgent.profileId) : undefined
        if (moderatorAgent && moderatorProfile) {
          addRow(moderatorProfile.id, moderatorProfile.displayName, moderatorProfile.model, `${moderatorAgent.displayName}(主持人)`)
        }
      }
    } catch {
      // 引擎状态不可读（已结束 / Redis 不可用）不影响玩家侧状态展示。
    }
  }

  const entries = await Promise.all(
    Array.from(grouped.values()).map(async (entry) => {
      // Redis 不可用时按「未上传」展示，重新上传入口仍然可用。
      const present = await getApiKey(matchId, entry.profileId).then(
        (apiKey) => apiKey !== undefined,
        () => false,
      )
      return { ...entry, present }
    }),
  )

  return Response.json({ matchId, gameType: match.gameType, entries })
}
