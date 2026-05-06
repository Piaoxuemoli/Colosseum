import { randomUUID } from 'node:crypto'

export function newId(): string {
  return randomUUID()
}

export function newMatchId(): string {
  return `match_${randomUUID()}`
}

export function newAgentId(): string {
  return `agt_${randomUUID()}`
}

export function newProfileId(): string {
  return `prof_${randomUUID()}`
}

export function newEventId(): string {
  return `evt_${randomUUID()}`
}

export function newTaskId(input: {
  matchId: string
  handNumber: number
  agentId: string
}): string {
  return `task_${input.matchId}-${input.handNumber}-${input.agentId}`
}

export function newMatchToken(): string {
  return `${randomUUID().replace(/-/g, '')}${randomUUID().replace(/-/g, '')}`
}

export function parsePrefix(id: string): string | null {
  const match = id.match(/^([a-z]+)_/)
  return match ? match[1] : null
}
