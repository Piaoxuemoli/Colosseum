'use client'

import Link from 'next/link'
import { useEffect } from 'react'
import { ArrowLeft } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { RightPanel } from '@/components/match/RightPanel'
import { ReplayControls } from '@/components/match/ReplayControls'
import { PokerBoard } from '@/games/poker/ui/PokerBoard'
import { WerewolfBoard } from '@/games/werewolf/ui/WerewolfBoard'
import type { GameEvent } from '@/lib/core/types'
import {
  useMatchViewStore,
  type PokerUiPlayer,
} from '@/store/match-view-store'
import { useReplayStore } from '@/store/replay-store'

type Props = {
  matchId: string
  gameType: 'poker' | 'werewolf'
  initialPlayers: PokerUiPlayer[]
  events: GameEvent[]
  initialChips: number
  totalEvents: number
}

export function ReplayView({
  matchId,
  gameType,
  initialPlayers,
  events,
  totalEvents,
}: Props) {
  const load = useReplayStore((s) => s.load)
  const reset = useReplayStore((s) => s.reset)

  const players = useMatchViewStore((s) => s.players)
  const communityCards = useMatchViewStore((s) => s.communityCards)
  const pot = useMatchViewStore((s) => s.pot)
  const phase = useMatchViewStore((s) => s.phase)
  const currentActor = useMatchViewStore((s) => s.currentActor)
  const dealerIndex = useMatchViewStore((s) => s.dealerIndex)
  const thinkingByAgent = useMatchViewStore((s) => s.thinkingByAgent)
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

  const werewolfPlayers =
    players.length > 0 ? players : initialPlayers

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
            thinkingByAgent={thinkingByAgent}
          />
        ) : (
          <WerewolfBoard players={werewolfPlayers} currentActor={currentActor} />
        )}
      </main>

      <RightPanel matchId={matchId} />
      <ReplayControls />
    </div>
  )
}
