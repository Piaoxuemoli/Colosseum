import { listMatchEvents } from '@/lib/db/queries/events'
import { findMatchById, listParticipants } from '@/lib/db/queries/matches'

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
