import { deleteMatch } from '@/backend/orchestrator/match-cleanup'
import { listMatchEvents } from '@/platform/db/queries/events'
import { findMatchById, listParticipants } from '@/platform/db/queries/matches'
import { getMatchUsageDigest } from '@/platform/db/queries/stats'
import { db } from '@/platform/db/client'

export const runtime = 'nodejs'

export async function GET(
  _req: Request,
  context: { params: Promise<{ matchId: string }> },
): Promise<Response> {
  const { matchId } = await context.params
  const match = await findMatchById(matchId)
  if (!match) return Response.json({ error: 'not found' }, { status: 404 })

  const participants = await listParticipants(matchId)
  const events = await listMatchEvents(matchId, { visibility: 'public' })
  // FR-4.8-03 / NFR-06：对局详情附带按选手 / 按用途的用量摘要。
  const usage = await getMatchUsageDigest(db, matchId)
  return Response.json({ match, participants, eventCount: events.length, usage })
}

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ matchId: string }> },
): Promise<Response> {
  const { matchId } = await context.params
  const match = await findMatchById(matchId)
  if (!match) return Response.json({ error: 'not found' }, { status: 404 })

  try {
    await deleteMatch(matchId)
    return Response.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'delete failed'
    const status = message.includes('retry') ? 409 : 500
    return Response.json({ error: message }, { status })
  }
}
