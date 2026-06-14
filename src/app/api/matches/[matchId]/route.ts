import { deleteMatch } from '@/backend/orchestrator/match-cleanup'
import { listMatchEvents } from '@/platform/db/queries/events'
import { findMatchById, listParticipants } from '@/platform/db/queries/matches'

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
  return Response.json({ match, participants, eventCount: events.length })
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
