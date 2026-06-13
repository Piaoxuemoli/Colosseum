import { asc, eq } from 'drizzle-orm'
import { agents, matches, matchParticipants } from '@/platform/db/schema.sqlite'
import { db } from '@/platform/db/client'
import { listMatchEvents } from '@/platform/db/queries/events'
import type { GameEvent } from '@/platform/core/types'
import type { PokerUiPlayer } from '@/frontend/store/match-view-store'

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

const FALLBACK_INITIAL_CHIPS = 200

function extractStartingChips(events: GameEvent[]): number {
  const stateEvent = events.find((event) => event.kind === 'poker/state')
  const payload = stateEvent?.payload as Record<string, unknown> | undefined
  if (payload && typeof payload.startingChips === 'number') {
    return payload.startingChips
  }
  return FALLBACK_INITIAL_CHIPS
}

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

  const initialEvents = await listMatchEvents(matchId, { visibility: 'public', limit: 100 })
  const initialChips = extractStartingChips(initialEvents)

  const initialPlayers: PokerUiPlayer[] = participants.map((p) => ({
    agentId: p.agentId,
    displayName: p.agentName ?? p.agentId,
    avatarEmoji: p.agentAvatar ?? '🃏',
    seatIndex: p.seatIndex,
    chips: initialChips,
    currentBet: 0,
    status: 'active',
    holeCards: [],
  }))

  return { match, initialPlayers, initialEvents, initialChips }
}
