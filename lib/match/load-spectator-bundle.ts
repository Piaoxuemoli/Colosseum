import { asc, eq } from 'drizzle-orm'
import { agents, matches, matchParticipants } from '@/lib/db/schema.sqlite'
import { db } from '@/lib/db/client'
import { listMatchEvents } from '@/lib/db/queries/events'
import type { GameEvent } from '@/lib/core/types'
import type { PokerUiPlayer } from '@/store/match-view-store'

/**
 * Shared loader used by both the live spectator page and the replay page.
 * Returns everything needed to hydrate `match-view-store`:
 *   - match row (gameType, status, config)
 *   - initial players built from `matchParticipants` × `agents`
 *   - initial events (public-visibility; replay consumers can further slice)
 *
 * Returns `null` if the match does not exist so callers can trigger notFound().
 */
export type MatchSpectatorBundle = {
  match: typeof matches.$inferSelect
  initialPlayers: PokerUiPlayer[]
  initialEvents: GameEvent[]
  initialChips: number
}

const INITIAL_CHIPS = 200

export async function loadMatchSpectatorBundle(
  matchId: string,
): Promise<MatchSpectatorBundle | null> {
  const [match] = await db
    .select()
    .from(matches)
    .where(eq(matches.id, matchId))
    .limit(1)
  if (!match) return null

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

  const initialPlayers: PokerUiPlayer[] = participants.map((p) => ({
    agentId: p.agentId,
    displayName: p.agentName ?? p.agentId,
    avatarEmoji: p.agentAvatar ?? '🃏',
    seatIndex: p.seatIndex,
    chips: INITIAL_CHIPS,
    currentBet: 0,
    status: 'active',
    holeCards: [],
  }))

  const initialEvents = await listMatchEvents(matchId, { visibility: 'public' })

  return { match, initialPlayers, initialEvents, initialChips: INITIAL_CHIPS }
}
