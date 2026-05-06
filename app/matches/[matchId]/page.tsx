import { asc, eq } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import { agents, matches, matchParticipants } from '@/lib/db/schema.sqlite'
import { db } from '@/lib/db/client'
import { listMatchEvents } from '@/lib/db/queries/events'
import type { PokerUiPlayer } from '@/store/match-view-store'
import { SpectatorView } from './SpectatorView'

export const dynamic = 'force-dynamic'

export default async function MatchPage({ params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = await params
  const [match] = await db.select().from(matches).where(eq(matches.id, matchId)).limit(1)
  if (!match) notFound()

  const participants = await db
    .select({
      agentId: matchParticipants.agentId,
      seatIndex: matchParticipants.seatIndex,
      agentName: agents.displayName,
      agentAvatar: agents.avatarEmoji,
    })
    .from(matchParticipants)
    .leftJoin(agents, eq(matchParticipants.agentId, agents.id))
    .where(eq(matchParticipants.matchId, matchId))
    .orderBy(asc(matchParticipants.seatIndex))

  const initialPlayers: PokerUiPlayer[] = participants.map((participant) => ({
    agentId: participant.agentId,
    displayName: participant.agentName ?? participant.agentId,
    avatarEmoji: participant.agentAvatar ?? '🃏',
    seatIndex: participant.seatIndex,
    chips: 200,
    currentBet: 0,
    status: 'active',
    holeCards: [],
  }))

  const initialEvents = await listMatchEvents(matchId, { visibility: 'public' })

  return (
    <SpectatorView
      matchId={matchId}
      gameType={match.gameType as 'poker' | 'werewolf'}
      initialPlayers={initialPlayers}
      initialEvents={initialEvents}
      status={match.status}
    />
  )
}
