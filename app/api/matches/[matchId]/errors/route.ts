import { listErrorsByMatch } from '@/lib/db/queries/errors'

export const runtime = 'nodejs'

export async function GET(
  _req: Request,
  context: { params: Promise<{ matchId: string }> },
): Promise<Response> {
  const { matchId } = await context.params
  const errors = await listErrorsByMatch(matchId, 20)
  return Response.json({ matchId, count: errors.length, errors })
}
