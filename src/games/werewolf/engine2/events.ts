// Werewolf engine v2 — event construction + audience filtering (WFR-2xx).
//
// The event stream is the single source of truth (WFR-501). Every event
// carries an audience marker; `visibleEvents` applies the same filter for
// live spectating and replay (WFR-206). Roles are derived from the stream
// itself (rolesAssigned events), so the filter needs no external state.

import type {
  Audience,
  EventPayloadMap,
  RoleId,
  WerewolfAction,
  WerewolfEvent,
  WerewolfEventKind,
} from './types'

/** Who is asking to see the stream. `god` = 观战上帝视角（全量, WFR-206）. */
export type EventViewer =
  | { type: 'player'; playerId: string }
  | { type: 'moderator' }
  | { type: 'god' }
  | { type: 'public-only' }

/**
 * WFR-202 knowledge-isolation predicate. Player views get: public events,
 * wolves-channel events (if the player is a werewolf — wolf identity is a
 * private fact that survives death for replay purposes), their own
 * role-self events, and sheriff-audience events while holding the badge
 * (v1-M2). Moderator and god viewers see everything.
 */
export function eventVisibleTo(
  event: WerewolfEvent,
  viewer: EventViewer,
  roles: ReadonlyMap<string, RoleId>,
  sheriffId: string | null,
): boolean {
  switch (viewer.type) {
    case 'moderator':
    case 'god':
      return true
    case 'public-only':
      return event.audience.kind === 'public'
    case 'player': {
      const audience = event.audience
      switch (audience.kind) {
        case 'public':
          return true
        case 'role-self':
          return audience.playerId === viewer.playerId
        case 'wolves':
          return roles.get(viewer.playerId) === 'werewolf'
        case 'sheriff':
          return sheriffId === viewer.playerId
        case 'moderator':
          return false
      }
    }
  }
}

/**
 * Filter the full event stream down to what `viewer` may see. Role
 * assignments are recovered from the stream (rolesAssigned events); the
 * sheriff identity is a v1-M2 slot and stays null in M1.
 */
export function visibleEvents(
  events: readonly WerewolfEvent[],
  viewer: EventViewer,
): WerewolfEvent[] {
  const roles = new Map<string, RoleId>()
  // v1-M2 slot: once sheriff events exist, the sheriff identity will be
  // derived from the stream here. M1 boards have no sheriff.
  const sheriffId: string | null = null
  const visible: WerewolfEvent[] = []
  for (const event of events) {
    // Maintain the role map incrementally so pre-assignment events filter
    // exactly as they did live.
    if (event.kind === 'rolesAssigned' && event.actorId !== null) {
      roles.set(event.actorId, event.payload.role)
    }
    if (eventVisibleTo(event, viewer, roles, sheriffId)) visible.push(event)
  }
  return visible
}

/**
 * Event factory used by the phase machine. The generic→union assignment is
 * not provable for a generic K, hence the single contained cast (payload
 * types are still fully checked at every concrete call site).
 */
export function makeEvent<K extends WerewolfEventKind>(args: {
  seq: number
  day: number
  kind: K
  audience: Audience
  actorId: string | null
  payload: EventPayloadMap[K]
  isDefault?: boolean
  action?: WerewolfAction
}): WerewolfEvent {
  const event = {
    seq: args.seq,
    day: args.day,
    kind: args.kind,
    audience: args.audience,
    actorId: args.actorId,
    payload: args.payload,
    ...(args.isDefault === true ? { isDefault: true as const } : {}),
    ...(args.action !== undefined ? { action: args.action } : {}),
  }
  // Generic K → union member assignment is not provable for TS; every
  // concrete call site is fully checked, this is the single contained cast.
  return event as WerewolfEvent
}
