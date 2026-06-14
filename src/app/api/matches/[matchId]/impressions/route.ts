import { findAgentById } from '@/platform/db/queries/agents'
import { loadAllSemanticForObserver } from '@/platform/db/queries/memory'
import { findMatchById, listParticipants } from '@/platform/db/queries/matches'
import type { GameType } from '@/platform/core/types'

export const runtime = 'nodejs'

export type MatchImpressionRow = {
  observerAgentId: string
  observerName: string
  targetAgentId: string
  targetName: string
  gamesObserved: number
  profile: Record<string, unknown>
}

export async function GET(
  _req: Request,
  context: { params: Promise<{ matchId: string }> },
): Promise<Response> {
  const { matchId } = await context.params
  const match = await findMatchById(matchId)
  if (!match) return Response.json({ error: 'not found' }, { status: 404 })

  const participants = await listParticipants(matchId)
  const participantIds = new Set(participants.map((participant) => participant.agentId))
  const agentNames = new Map<string, string>()

  await Promise.all(
    participants.map(async (participant) => {
      const agent = await findAgentById(participant.agentId)
      agentNames.set(participant.agentId, agent?.displayName ?? participant.agentId)
    }),
  )

  const rows: MatchImpressionRow[] = []
  for (const observer of participants) {
    const semantic = await loadAllSemanticForObserver({
      observerAgentId: observer.agentId,
      gameType: match.gameType as GameType,
    })

    for (const [targetAgentId, entry] of semantic.entries()) {
      if (!participantIds.has(targetAgentId) || targetAgentId === observer.agentId) continue
      rows.push({
        observerAgentId: observer.agentId,
        observerName: agentNames.get(observer.agentId) ?? observer.agentId,
        targetAgentId,
        targetName: agentNames.get(targetAgentId) ?? targetAgentId,
        gamesObserved: entry.gamesObserved,
        profile: entry.profileJson,
      })
    }
  }

  rows.sort((a, b) => a.observerName.localeCompare(b.observerName) || a.targetName.localeCompare(b.targetName))

  return Response.json({
    gameType: match.gameType,
    participantCount: participants.length,
    impressionCount: rows.length,
    impressions: rows,
  })
}
