import { listErrorsByMatch } from '@/platform/db/queries/errors'
import { findAgentById } from '@/platform/db/queries/agents'

export const runtime = 'nodejs'

export async function GET(
  _req: Request,
  context: { params: Promise<{ matchId: string }> },
): Promise<Response> {
  const { matchId } = await context.params
  const errors = await listErrorsByMatch(matchId, 50)
  const agentNames = new Map<string, string>()

  await Promise.all(
    Array.from(new Set(errors.map((error) => error.agentId))).map(async (agentId) => {
      const agent = await findAgentById(agentId).catch(() => undefined)
      agentNames.set(agentId, agent?.displayName ?? agentId)
    }),
  )

  return Response.json({
    matchId,
    count: errors.length,
    errors: errors.map((error) => ({
      id: error.id,
      agentId: error.agentId,
      agentName: agentNames.get(error.agentId) ?? error.agentId,
      layer: error.layer,
      errorCode: error.errorCode,
      occurredAt: error.occurredAt,
      rawResponse: error.rawResponse,
      recoveryAction: error.recoveryAction,
    })),
  })
}
