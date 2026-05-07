'use client'

import { useMemo } from 'react'
import { ModeratorPanel } from './ModeratorPanel'
import { PlayerCard } from './PlayerCard'
import { SpeechBubbleList } from './SpeechBubble'
import { VoteTally } from './VoteTally'
import { useMatchViewStore } from '@/store/match-view-store'
import type { PokerUiPlayer } from '@/store/match-view-store'

export function WerewolfBoard({
  players,
  currentActor,
}: {
  players: PokerUiPlayer[]
  currentActor: string | null
}) {
  const ww = useMatchViewStore((s) => s.werewolf)

  // Derive most-recent claimedRole per player from the speechLog.
  const claimedByAgent = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of ww.speechLog) {
      if (s.claimedRole) m.set(s.agentId, s.claimedRole)
    }
    return m
  }, [ww.speechLog])

  const ordered = [...players].sort((a, b) => a.seatIndex - b.seatIndex)
  const left = ordered.slice(0, 3)
  const right = ordered.slice(3, 6)

  return (
    <div
      className="grid gap-4 lg:grid-cols-[1fr_2fr_1fr]"
      data-testid="werewolf-board"
    >
      {/* Left column — moderator + left half of seats */}
      <div className="flex flex-col gap-3">
        <ModeratorPanel />
        <div className="flex flex-col gap-2">
          {left.map((p) => (
            <PlayerCard
              key={p.agentId}
              agentId={p.agentId}
              name={p.displayName}
              alive={true}
              claimedRole={claimedByAgent.get(p.agentId)}
              revealedRole={ww.roleAssignments?.[p.agentId] ?? null}
              isCurrentActor={currentActor === p.agentId}
            />
          ))}
        </div>
      </div>

      {/* Middle column — day/phase header + speech timeline */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between rounded-md border border-neutral-800 bg-neutral-900/60 px-3 py-2 text-sm">
          <span className="font-semibold text-neutral-200">Day {ww.day}</span>
          <span className="font-mono text-xs text-neutral-400">{ww.phase ?? '—'}</span>
        </div>
        <div className="min-h-[320px] flex-1">
          <SpeechBubbleList />
        </div>
      </div>

      {/* Right column — right half of seats + vote tally */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2">
          {right.map((p) => (
            <PlayerCard
              key={p.agentId}
              agentId={p.agentId}
              name={p.displayName}
              alive={true}
              claimedRole={claimedByAgent.get(p.agentId)}
              revealedRole={ww.roleAssignments?.[p.agentId] ?? null}
              isCurrentActor={currentActor === p.agentId}
            />
          ))}
        </div>
        <VoteTally />
      </div>
    </div>
  )
}
