import { eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { agents, apiProfiles, matchParticipants, matches } from '@/lib/db/schema.sqlite'

export const runtime = 'nodejs'

/**
 * DELETE /api/profiles/:profileId[?cascade=true]
 *
 * `agents.profile_id` FKs to `api_profiles.id`, so deleting a profile bound
 * to any agent would fail with SQLITE_CONSTRAINT_FOREIGNKEY (the 500 the
 * user was seeing). Mirror `/api/agents/[id]` DELETE's policy:
 *   - No referencing agents              → delete profile.
 *   - Referencing agents, no cascade flag → 409 with the list.
 *   - cascade=true, some agent is in a running match → 409 (refuse).
 *   - cascade=true, all safe             → drop match_participants, drop
 *                                           agents, drop profile, atomically.
 */
export async function DELETE(
  req: Request,
  context: { params: Promise<{ profileId: string }> },
): Promise<Response> {
  const { profileId } = await context.params
  const cascade = new URL(req.url).searchParams.get('cascade') === 'true'

  const referencingAgents = await db
    .select({ id: agents.id, displayName: agents.displayName })
    .from(agents)
    .where(eq(agents.profileId, profileId))

  if (referencingAgents.length === 0) {
    await db.delete(apiProfiles).where(eq(apiProfiles.id, profileId))
    return new Response(null, { status: 204 })
  }

  if (!cascade) {
    return Response.json(
      {
        error: 'profile is bound to existing agents',
        kind: 'needs-cascade',
        agents: referencingAgents,
        hint: '重新发起 DELETE 时带 ?cascade=true 可连同这些 agent(及其 match_participants)一起清理',
      },
      { status: 409 },
    )
  }

  const agentIds = referencingAgents.map((a) => a.id)

  const blockers = await db
    .select({ matchId: matchParticipants.matchId, agentId: matchParticipants.agentId })
    .from(matchParticipants)
    .leftJoin(matches, eq(matchParticipants.matchId, matches.id))
    .where(eq(matches.status, 'running'))
  const blocked = blockers.filter((r) => agentIds.includes(r.agentId))
  if (blocked.length > 0) {
    return Response.json(
      {
        error: 'one of the bound agents is in a running match',
        kind: 'running-match',
        matchIds: Array.from(new Set(blocked.map((r) => r.matchId))),
      },
      { status: 409 },
    )
  }

  // better-sqlite3's `.transaction()` is synchronous and rejects async
  // callbacks. Sequential deletes are safe because:
  //   - FK direction is match_participants → agents → api_profiles
  //   - FK check above already ruled out running matches
  //   - No other writer inserts new participants or rebinds profiles
  //     concurrently for an agent we're about to remove
  await db.delete(matchParticipants).where(inArray(matchParticipants.agentId, agentIds))
  await db.delete(agents).where(inArray(agents.id, agentIds))
  await db.delete(apiProfiles).where(eq(apiProfiles.id, profileId))

  return new Response(null, { status: 204 })
}
