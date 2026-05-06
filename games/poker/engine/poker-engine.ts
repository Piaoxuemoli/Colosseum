import { newEventId } from '@/lib/core/ids'
import type { GameEvent, MatchResult } from '@/lib/core/types'
import type { ActionSpec, ApplyActionResult, BoundaryKind, GameEngine } from '@/lib/engine/contracts'
import { createDeck, shuffleDeck } from './card'
import { dealCards } from './deck'
import type { PokerAction, PokerConfig, PokerPlayerState, PokerState } from './poker-types'

export class PokerEngine implements GameEngine<PokerState, PokerAction, PokerConfig> {
  createInitialState(config: PokerConfig, agentIds: string[]): PokerState {
    if (agentIds.length < 2) throw new Error('poker: at least 2 players required')

    const players: PokerPlayerState[] = agentIds.map((id, seatIndex) => ({
      id,
      seatIndex,
      chips: config.startingChips,
      holeCards: [],
      status: 'active',
      currentBet: 0,
      totalCommitted: 0,
      hasActedThisStreet: false,
    }))

    const dealerIndex = Math.floor(Math.random() * players.length)
    let remaining = shuffleDeck(createDeck())

    for (const player of players) {
      const result = dealCards(remaining, 2)
      player.holeCards = result.dealt
      remaining = result.remaining
    }

    const smallBlindIndex = (dealerIndex + 1) % players.length
    const bigBlindIndex = (dealerIndex + 2) % players.length
    this.postBlind(players[smallBlindIndex], config.smallBlind)
    this.postBlind(players[bigBlindIndex], config.bigBlind)

    const underTheGunIndex = (dealerIndex + 3) % players.length

    return {
      phase: 'preflop',
      handNumber: 1,
      dealerIndex,
      players,
      communityCards: [],
      currentActor: players[underTheGunIndex].id,
      actionHistory: [],
      betsThisStreet: 1,
      smallBlind: config.smallBlind,
      bigBlind: config.bigBlind,
      handComplete: false,
      matchComplete: false,
      deck: remaining,
    }
  }

  currentActor(state: PokerState): string | null {
    return state.currentActor
  }

  availableActions(_state: PokerState, _agentId: string): ActionSpec<PokerAction>[] {
    throw new Error('not implemented yet (Task 15)')
  }

  applyAction(_state: PokerState, _agentId: string, _action: PokerAction): ApplyActionResult<PokerState> {
    throw new Error('not implemented yet (Task 15)')
  }

  boundary(_prevState: PokerState, _nextState: PokerState): BoundaryKind | null {
    throw new Error('not implemented yet (Task 16)')
  }

  finalize(_state: PokerState): MatchResult {
    throw new Error('not implemented yet (Task 17)')
  }

  private postBlind(player: PokerPlayerState, amount: number): void {
    const paid = Math.min(player.chips, amount)
    player.chips -= paid
    player.currentBet = paid
    player.totalCommitted = paid
    if (paid < amount || player.chips === 0) player.status = 'allIn'
  }

  protected makeEvent(input: {
    matchId?: string
    kind: string
    actorAgentId: string | null
    payload: Record<string, unknown>
    visibility?: GameEvent['visibility']
    restrictedTo?: string[] | null
  }): GameEvent {
    return {
      id: newEventId(),
      matchId: input.matchId ?? '',
      gameType: 'poker',
      seq: 0,
      occurredAt: new Date().toISOString(),
      kind: input.kind,
      actorAgentId: input.actorAgentId,
      payload: input.payload,
      visibility: input.visibility ?? 'public',
      restrictedTo: input.restrictedTo ?? null,
    }
  }
}
