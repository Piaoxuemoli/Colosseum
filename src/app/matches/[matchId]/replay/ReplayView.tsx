'use client'

import Link from 'next/link'
import { useEffect, useMemo } from 'react'
import { ArrowLeft } from 'lucide-react'
import { Badge } from '@/frontend/components/ui/badge'
import { RightPanel } from '@/frontend/components/match/RightPanel'
import { ReplaySummaryPanel } from '@/frontend/components/match/ReplaySummaryPanel'
import { ReplayControls } from '@/frontend/components/match/ReplayControls'
import { SettlementTrustSection } from '@/frontend/components/match/SettlementTrustSection'
import { ViewModeToggle } from '@/frontend/components/match/ViewModeToggle'
import { PokerBoard } from '@/games/poker/ui/PokerBoard'
import { WerewolfBoard } from '@/games/werewolf/ui/WerewolfBoard'
import type { GameEvent } from '@/platform/core/types'
import { useMatchViewStore, type PokerUiPlayer } from '@/frontend/store/match-view-store'
import { useReplayStore } from '@/frontend/store/replay-store'
import { useThinkingStore } from '@/frontend/store/thinking-store'
import { thinkingEntryFromEvent } from '@/frontend/lib/client/thinking-events'

type Props = {
  matchId: string
  gameType: 'poker' | 'werewolf'
  initialPlayers: PokerUiPlayer[]
  events: GameEvent[]
  initialChips: number
  totalEvents: number
  finalRanking: Record<string, unknown> | null
}

export function ReplayView({
  matchId,
  gameType,
  initialPlayers,
  events,
  initialChips,
  totalEvents,
  finalRanking,
}: Props) {
  const load = useReplayStore((s) => s.load)
  const reset = useReplayStore((s) => s.reset)
  const cursor = useReplayStore((s) => s.cursor)
  const rehydrateThinking = useThinkingStore((s) => s.rehydrate)

  const players = useMatchViewStore((s) => s.players)
  const communityCards = useMatchViewStore((s) => s.communityCards)
  const pot = useMatchViewStore((s) => s.pot)
  const streetPots = useMatchViewStore((s) => s.streetPots)
  const sidePots = useMatchViewStore((s) => s.sidePots)
  const phase = useMatchViewStore((s) => s.phase)
  const currentActor = useMatchViewStore((s) => s.currentActor)
  const dealerIndex = useMatchViewStore((s) => s.dealerIndex)
  const smallBlindIndex = useMatchViewStore((s) => s.smallBlindIndex)
  const bigBlindIndex = useMatchViewStore((s) => s.bigBlindIndex)
  const werewolfDay = useMatchViewStore((s) => s.werewolf.day)
  const werewolfPhase = useMatchViewStore((s) => s.werewolf.phase)

  useEffect(() => {
    // `load` resets both stores, re-seats via the saved seatSetup, and
    // stores the full event buffer for the controls to step through.
    load(events, { matchId, players: initialPlayers })
    return () => {
      reset()
    }
  }, [events, initialPlayers, load, matchId, reset])

  // FR-4.6-03 思考链回放：思考历史随回放光标重灌——只呈现「已播放到」的
  // 思考条目（后退 seek 丢弃未来条目），过滤状态（agentFilter）保持。
  const nameByAgent = useMemo(() => {
    const map = new Map<string, string>()
    for (const player of initialPlayers) map.set(player.agentId, player.displayName)
    return map
  }, [initialPlayers])

  useEffect(() => {
    const entries = []
    for (const event of events.slice(0, cursor)) {
      const entry = thinkingEntryFromEvent(
        event,
        (event.actorAgentId ? nameByAgent.get(event.actorAgentId) : undefined) ?? event.actorAgentId ?? '',
      )
      if (entry) entries.push(entry)
    }
    rehydrateThinking(entries)
  }, [cursor, events, nameByAgent, rehydrateThinking])

  const werewolfPlayers = players.length > 0 ? players : initialPlayers

  return (
    <div
      className="flex min-h-screen flex-col gap-4 bg-neutral-950 px-4 pb-24 pt-6 text-neutral-100 md:px-8 lg:flex-row"
      data-testid="replay-view"
    >
      <main className="min-w-0 flex-1">
        <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.35em] text-emerald-300">
              <Link
                href={`/matches/${matchId}`}
                className="inline-flex items-center gap-1 text-emerald-400 hover:underline"
              >
                <ArrowLeft size={12} /> 返回观战页
              </Link>
              <span>·</span>
              <span>Replay</span>
            </div>
            <h1 className="mt-3 text-3xl font-black tracking-tight text-white">
              {gameType === 'poker' ? '德州扑克 · 回放' : '狼人杀 · 回放'}
            </h1>
            <p className="mt-2 font-mono text-xs text-muted-foreground">{matchId}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">
              {gameType === 'poker' ? phase : werewolfPhase ?? 'waiting'}
            </Badge>
            <Badge variant="secondary">共 {totalEvents} 个事件</Badge>
            {gameType === 'werewolf' ? <Badge>Day {werewolfDay}</Badge> : null}
            <ViewModeToggle />
          </div>
        </div>

        {gameType === 'poker' ? (
          <PokerBoard
            players={players.length > 0 ? players : initialPlayers}
            communityCards={communityCards}
            pot={pot}
            phase={phase}
            currentActor={currentActor}
            dealerIndex={dealerIndex}
            smallBlindIndex={smallBlindIndex}
            bigBlindIndex={bigBlindIndex}
            streetPots={streetPots}
            sidePots={sidePots}
          />
        ) : (
          <WerewolfBoard players={werewolfPlayers} currentActor={currentActor} />
        )}

        <SettlementTrustSection matchId={matchId} events={events} finalRanking={finalRanking} />

        <ReplaySummaryPanel
          gameType={gameType}
          players={players.length > 0 ? players : initialPlayers}
          events={events}
          initialChips={initialChips}
        />
      </main>

      <RightPanel matchId={matchId} gameType={gameType} />
      <ReplayControls />
    </div>
  )
}
