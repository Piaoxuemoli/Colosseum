import type { GameEvent } from '@/lib/core/types'
import type {
  BeliefEntry,
  DeathRecord,
  WerewolfWorkingMemory,
} from './types'
import type { SeerResult, SpeechRecord, VoteRecord, WerewolfRole } from '../engine/types'

export function initWorkingMemory(matchId: string, observerAgentId: string): WerewolfWorkingMemory {
  return {
    matchId,
    observerAgentId,
    ownRole: null,
    ownPrivateEvidence: {},
    speechLog: [],
    voteLog: [],
    deathLog: [],
    beliefState: {},
  }
}

/**
 * Update working memory with a single engine event.
 *
 * Visibility is enforced by the orchestrator (game-master) BEFORE events are
 * persisted to a given observer: events whose `restrictedTo` list does not
 * include the observer should never reach this function. We defensively still
 * check before ingesting role-restricted events here so that an incorrectly
 * routed event can't leak info.
 */
export function updateWorkingMemory(
  previous: WerewolfWorkingMemory,
  event: GameEvent,
): WerewolfWorkingMemory {
  const observer = previous.observerAgentId
  if (
    event.visibility === 'role-restricted' &&
    event.restrictedTo &&
    !event.restrictedTo.includes(observer)
  ) {
    return previous
  }
  if (event.visibility === 'private') return previous

  switch (event.kind) {
    case 'werewolf/match-start':
      return ingestMatchStart(previous, event)
    case 'werewolf/speak':
    case 'werewolf/werewolfDiscuss':
      return ingestSpeech(previous, event)
    case 'werewolf/vote':
      return ingestVote(previous, event)
    case 'werewolf/seerCheck':
      return ingestSeerCheck(previous, event)
    case 'werewolf/witchSave':
    case 'werewolf/witchPoison':
      return ingestWitchAction(previous, event)
    case 'werewolf/werewolfKill':
      return ingestWerewolfKill(previous, event)
    case 'werewolf/execute':
      return ingestExecute(previous, event)
    default:
      return previous
  }
}

function ingestMatchStart(
  prev: WerewolfWorkingMemory,
  event: GameEvent,
): WerewolfWorkingMemory {
  const payload = event.payload as {
    roleAssignments?: Record<string, WerewolfRole>
    teammates?: string[]
  }
  const role = payload.roleAssignments?.[prev.observerAgentId] ?? null
  const evidence: WerewolfWorkingMemory['ownPrivateEvidence'] = { ...prev.ownPrivateEvidence }
  if (role === 'werewolf') {
    evidence.werewolfTeammates = payload.teammates ?? []
  }
  if (role === 'witch') {
    evidence.witchPotions = { save: true, poison: true }
  }
  return { ...prev, ownRole: role, ownPrivateEvidence: evidence }
}

function ingestSpeech(prev: WerewolfWorkingMemory, event: GameEvent): WerewolfWorkingMemory {
  const payload = event.payload as { day?: number; content?: string; claimedRole?: WerewolfRole }
  if (!event.actorAgentId || typeof payload.content !== 'string') return prev
  const rec: SpeechRecord = {
    day: payload.day ?? 0,
    agentId: event.actorAgentId,
    content: payload.content,
    claimedRole: payload.claimedRole,
    at: Date.parse(event.occurredAt) || 0,
  }
  return { ...prev, speechLog: [...prev.speechLog, rec] }
}

function ingestVote(prev: WerewolfWorkingMemory, event: GameEvent): WerewolfWorkingMemory {
  const payload = event.payload as { day?: number; target?: string | null; reason?: string | null }
  if (!event.actorAgentId) return prev
  const rec: VoteRecord = {
    day: payload.day ?? 0,
    voter: event.actorAgentId,
    target: payload.target ?? null,
    reason: payload.reason ?? undefined,
    at: Date.parse(event.occurredAt) || 0,
  }
  return { ...prev, voteLog: [...prev.voteLog, rec] }
}

function ingestSeerCheck(prev: WerewolfWorkingMemory, event: GameEvent): WerewolfWorkingMemory {
  if (prev.ownRole !== 'seer') return prev
  const payload = event.payload as { targetId?: string; role?: WerewolfRole; day?: number }
  if (!payload.targetId || !payload.role) return prev
  const rec: SeerResult = {
    day: payload.day ?? 0,
    targetId: payload.targetId,
    role: payload.role,
  }
  const evidence = {
    ...prev.ownPrivateEvidence,
    seerChecks: [...(prev.ownPrivateEvidence.seerChecks ?? []), rec],
  }
  return { ...prev, ownPrivateEvidence: evidence }
}

function ingestWitchAction(prev: WerewolfWorkingMemory, event: GameEvent): WerewolfWorkingMemory {
  if (prev.ownRole !== 'witch') return prev
  const potions = prev.ownPrivateEvidence.witchPotions ?? { save: true, poison: true }
  const next = { ...potions }
  if (event.kind === 'werewolf/witchSave') next.save = false
  if (event.kind === 'werewolf/witchPoison') {
    const payload = event.payload as { targetId?: string | null }
    if (payload.targetId) next.poison = false
  }
  return {
    ...prev,
    ownPrivateEvidence: { ...prev.ownPrivateEvidence, witchPotions: next },
  }
}

function ingestWerewolfKill(prev: WerewolfWorkingMemory, _event: GameEvent): WerewolfWorkingMemory {
  // The actual death is committed during `day/announce` / `execute`; here we
  // just record a `deathLog` entry once `announceDeath` surfaces, so no-op.
  return prev
}

function ingestExecute(prev: WerewolfWorkingMemory, event: GameEvent): WerewolfWorkingMemory {
  const payload = event.payload as {
    day?: number
    victimId?: string
    cause?: DeathRecord['cause']
  }
  if (!payload.victimId || !payload.cause) return prev
  const rec: DeathRecord = {
    day: payload.day ?? 0,
    agentId: payload.victimId,
    cause: payload.cause,
  }
  return { ...prev, deathLog: [...prev.deathLog, rec] }
}

/**
 * Merge a parser-supplied belief update into working memory. Missing
 * properties fall back to previous values or uniform prior (0.25).
 */
export function mergeBeliefUpdate(
  current: Record<string, BeliefEntry>,
  patch: Record<string, Partial<BeliefEntry>>,
): Record<string, BeliefEntry> {
  const next: Record<string, BeliefEntry> = { ...current }
  for (const [id, p] of Object.entries(patch)) {
    const prior = current[id]
    const merged: BeliefEntry = {
      werewolf: p.werewolf ?? prior?.werewolf ?? 0.25,
      villager: p.villager ?? prior?.villager ?? 0.25,
      seer: p.seer ?? prior?.seer ?? 0.25,
      witch: p.witch ?? prior?.witch ?? 0.25,
      reasoning: (p.reasoning ?? prior?.reasoning ?? []).slice(-3),
      lastUpdatedAt: p.lastUpdatedAt ?? prior?.lastUpdatedAt ?? { day: 0, phase: 'init' },
    }
    next[id] = merged
  }
  return next
}

export function formatWorkingForPrompt(memory: WerewolfWorkingMemory): string {
  const lines: string[] = []
  if (Object.keys(memory.beliefState).length > 0) {
    lines.push('## 当前信念分布')
    for (const [id, b] of Object.entries(memory.beliefState)) {
      lines.push(
        `- ${id}: 狼${b.werewolf.toFixed(2)} 神${(b.seer + b.witch).toFixed(2)} 民${b.villager.toFixed(2)}`,
      )
    }
  }
  return lines.join('\n')
}
