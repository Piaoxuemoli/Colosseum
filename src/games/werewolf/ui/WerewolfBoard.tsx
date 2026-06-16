'use client'

import { useMemo } from 'react'
import { ModeratorPanel } from './ModeratorPanel'
import { PlayerCard } from './PlayerCard'
import { SpeechBubbleList } from './SpeechBubble'
import { VoteTally } from './VoteTally'
import { useMatchViewStore } from '@/frontend/store/match-view-store'
import type { PokerUiPlayer } from '@/frontend/store/match-view-store'
import { useThinkingStore } from '@/frontend/store/thinking-store'
import type { WerewolfDeathCause } from './PlayerCard'

export function WerewolfBoard({
  players,
  currentActor,
}: {
  players: PokerUiPlayer[]
  currentActor: string | null
}) {
  const ww = useMatchViewStore((s) => s.werewolf)
  const currentThinking = useThinkingStore((s) => s.current)
  const thinkingText = (agentId: string) => currentThinking[agentId]?.text

  // Derive most-recent claimedRole per player from the speechLog.
  const claimedByAgent = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of ww.speechLog) {
      if (s.claimedRole) m.set(s.agentId, s.claimedRole)
    }
    return m
  }, [ww.speechLog])

  // 死亡公告 → 存活/死因（夜间刀毒、白日票出均经主持人公告落入 ww.deaths）。
  const deathCauseByAgent = useMemo(() => {
    const m = new Map<string, WerewolfDeathCause | null>()
    for (const d of ww.deaths) m.set(d.agentId, (d.cause as WerewolfDeathCause | null) ?? null)
    return m
  }, [ww.deaths])

  const ordered = [...players].sort((a, b) => a.seatIndex - b.seatIndex)
  const left = ordered.slice(0, 3)
  const right = ordered.slice(3, 6)

  // 狼人事件不更新 store.currentActor（仅扑克事件设置）；用「正在思考者」作为
  // 当前行动者信号——它与思考气泡同源，高亮与气泡一致。回退到 store.currentActor。
  const activeThinker = Object.keys(currentThinking)[0] ?? null
  const highlightActor = activeThinker ?? currentActor

  const renderCard = (p: PokerUiPlayer) => (
    <PlayerCard
      key={p.agentId}
      agentId={p.agentId}
      name={p.displayName}
      alive={!deathCauseByAgent.has(p.agentId)}
      deathCause={deathCauseByAgent.get(p.agentId) ?? null}
      claimedRole={claimedByAgent.get(p.agentId)}
      revealedRole={ww.roleAssignments?.[p.agentId] ?? null}
      isCurrentActor={highlightActor === p.agentId}
      thinking={thinkingText(p.agentId)}
    />
  )

  return (
    <div className="grid gap-4 grid-cols-1 lg:grid-cols-[1fr_2fr_1fr]" data-testid="werewolf-board">
      {/* Left column — moderator + left half of seats */}
      <div className="flex flex-col gap-3">
        <ModeratorPanel />
        <div className="flex flex-col gap-2">{left.map(renderCard)}</div>
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
        <div className="flex flex-col gap-2">{right.map(renderCard)}</div>
        <VoteTally />
      </div>
    </div>
  )
}
