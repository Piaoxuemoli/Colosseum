import { forceEndMatch } from '@/backend/orchestrator/match-cleanup'
import { findMatchById } from '@/platform/db/queries/matches'

export const runtime = 'nodejs'

export async function POST(
  _req: Request,
  context: { params: Promise<{ matchId: string }> },
): Promise<Response> {
  const { matchId } = await context.params
  const match = await findMatchById(matchId)
  if (!match) return Response.json({ error: 'not found' }, { status: 404 })
  if (match.status !== 'running') {
    return Response.json({ error: 'match is not running' }, { status: 409 })
  }

  try {
    const result = await forceEndMatch(matchId)
    return Response.json({ ok: true, viaFlag: result.viaFlag ?? false })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'force end failed'
    return Response.json({ error: message }, { status: 500 })
  }
}
