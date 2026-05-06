import type { GameEvent } from '@/lib/core/types'

export type PokerWorkingMemory = {
  matchActionsLog: Array<{
    seq: number
    kind: string
    actorAgentId: string | null
    payload: Record<string, unknown>
  }>
  currentHandNumber: number
}

export function initWorking(): PokerWorkingMemory {
  return { matchActionsLog: [], currentHandNumber: 1 }
}

export function updateWorking(previous: PokerWorkingMemory, event: GameEvent): PokerWorkingMemory {
  return {
    ...previous,
    matchActionsLog: [
      ...previous.matchActionsLog,
      {
        seq: event.seq,
        kind: event.kind,
        actorAgentId: event.actorAgentId,
        payload: event.payload,
      },
    ],
    currentHandNumber:
      event.kind === 'poker/match-end' || event.kind === 'poker/pot-award'
        ? previous.currentHandNumber + 1
        : previous.currentHandNumber,
  }
}

export function formatWorkingForPrompt(working: PokerWorkingMemory): string {
  const lines = working.matchActionsLog
    .slice(-20)
    .map(
      (action) =>
        `[seq ${action.seq}] ${action.kind}${action.actorAgentId ? ` by ${action.actorAgentId}` : ''}: ${JSON.stringify(action.payload)}`,
    )

  return `## Recent action log\n${lines.length > 0 ? lines.join('\n') : '(empty)'}`
}
