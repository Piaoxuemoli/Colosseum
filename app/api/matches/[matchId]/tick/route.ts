import { loadEnv } from '@/lib/env'
import { ensureGamesRegistered } from '@/lib/instrument'
import { tickMatch } from '@/lib/orchestrator/game-master'

export const runtime = 'nodejs'

export async function POST(
  _req: Request,
  context: { params: Promise<{ matchId: string }> },
): Promise<Response> {
  ensureGamesRegistered()
  const { matchId } = await context.params
  const result = await tickMatch(matchId)

  if (!result.done) {
    const env = loadEnv()
    fetch(`${env.BASE_URL}/api/matches/${matchId}/tick`, { method: 'POST' }).catch(() => {})
  }

  return Response.json(result)
}
