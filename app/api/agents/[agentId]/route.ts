import { eq } from 'drizzle-orm'
import { findAgentById } from '@/lib/db/queries/agents'
import { db } from '@/lib/db/client'
import { agents, matchParticipants, matches } from '@/lib/db/schema.sqlite'

export const runtime = 'nodejs'

export async function GET(
  _req: Request,
  context: { params: Promise<{ agentId: string }> },
): Promise<Response> {
  const { agentId } = await context.params
  const agent = await findAgentById(agentId)
  if (!agent) return Response.json({ error: 'not found' }, { status: 404 })
  return Response.json(agent)
}

/**
 * DELETE /api/agents/:agentId[?cascade=true]
 *
 * An agent may be referenced by `match_participants` rows from past matches.
 * Naively dropping the agent violates the FK and the UI used to see a 500.
 *
 * Behavior:
 *   - If a *running* match still references this agent → 409,user 必须先结束/删
 *     该对局(本阶段不支持中途删)。
 *   - 如果只被已结束(completed/errored/aborted_by_errors)对局引用:
 *       * 不带 ?cascade=true → 409,返回引用对局列表让 UI 弹确认。
 *       * 带 ?cascade=true     → 事务里先删 match_participants,再删 agent。
 *   - 若无引用 → 直接删。
 */
export async function DELETE(
  req: Request,
  context: { params: Promise<{ agentId: string }> },
): Promise<Response> {
  const { agentId } = await context.params
  const cascade = new URL(req.url).searchParams.get('cascade') === 'true'

  const refs = await db
    .select({
      matchId: matchParticipants.matchId,
      status: matches.status,
    })
    .from(matchParticipants)
    .leftJoin(matches, eq(matchParticipants.matchId, matches.id))
    .where(eq(matchParticipants.agentId, agentId))

  const running = refs.filter((r) => r.status === 'running')
  if (running.length > 0) {
    return Response.json(
      {
        error: 'agent is participating in a running match',
        kind: 'running-match',
        matchIds: running.map((r) => r.matchId),
      },
      { status: 409 },
    )
  }

  if (refs.length > 0 && !cascade) {
    return Response.json(
      {
        error: 'agent is referenced by settled matches',
        kind: 'needs-cascade',
        matchIds: refs.map((r) => r.matchId),
        hint: '重新发起 DELETE 时带 ?cascade=true 可连同 match_participants 一起清理',
      },
      { status: 409 },
    )
  }

  // Safe to delete. better-sqlite3's `.transaction()` is synchronous and
  // can't take an async callback; do the deletes sequentially instead.
  // The FK precheck above makes this race-free as long as no concurrent
  // INSERT INTO match_participants is happening for the same agentId,
  // which matches how the app uses it (participants are only written at
  // match create).
  if (refs.length > 0) {
    await db.delete(matchParticipants).where(eq(matchParticipants.agentId, agentId))
  }
  await db.delete(agents).where(eq(agents.id, agentId))

  return new Response(null, { status: 204 })
}
