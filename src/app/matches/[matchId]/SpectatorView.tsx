'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef } from 'react'
import { Badge } from '@/frontend/components/ui/badge'
import { FinishAfterHandButton } from '@/frontend/components/match/FinishAfterHandButton'
import { RightPanel } from '@/frontend/components/match/RightPanel'
import { RankingPanel } from '@/frontend/components/match/RankingPanel'
import { PokerBoard } from '@/games/poker/ui/PokerBoard'
import { WerewolfBoard } from '@/games/werewolf/ui/WerewolfBoard'
import { WerewolfResultPanel } from '@/games/werewolf/ui/WerewolfResultPanel'
import { useMatchStream } from '@/frontend/lib/client/sse'
import type { GameEvent } from '@/platform/core/types'
import { useMatchViewStore, type PokerUiPlayer } from '@/frontend/store/match-view-store'
import { useThinkingStore } from '@/frontend/store/thinking-store'

const THINKING_BATCH_MS = 80

type SseMessage =
  | { kind: 'event'; event: GameEvent }
  | { kind: 'thinking-delta'; agentId: string; delta: string }
  | { kind: 'agent-action-ready'; agentId: string; actionType: string }
  | { kind: 'match-end'; winnerAgentId: string | null }

export function SpectatorView({
  matchId,
  gameType,
  initialPlayers,
  initialEvents,
  initialChips,
  status,
}: {
  matchId: string
  gameType: 'poker' | 'werewolf'
  initialPlayers: PokerUiPlayer[]
  initialEvents: GameEvent[]
  initialChips: number
  status: string
}) {
  const init = useMatchViewStore((state) => state.init)
  const ingestEvent = useMatchViewStore((state) => state.ingestEvent)
  const setMatchEnd = useMatchViewStore((state) => state.setMatchEnd)
  const appendThinking = useThinkingStore((state) => state.appendThinking)
  const finalizeThinking = useThinkingStore((state) => state.finalizeThinking)

  const handNumber = useMatchViewStore((state) => state.handNumber)
  const players = useMatchViewStore((state) => state.players)

  const nameOf = useCallback(
    (agentId: string) => players.find((p) => p.agentId === agentId)?.displayName ?? agentId,
    [players],
  )
  const communityCards = useMatchViewStore((state) => state.communityCards)
  const pot = useMatchViewStore((state) => state.pot)
  const streetPots = useMatchViewStore((state) => state.streetPots)
  const sidePots = useMatchViewStore((state) => state.sidePots)
  const phase = useMatchViewStore((state) => state.phase)
  const currentActor = useMatchViewStore((state) => state.currentActor)
  const dealerIndex = useMatchViewStore((state) => state.dealerIndex)
  const smallBlindIndex = useMatchViewStore((state) => state.smallBlindIndex)
  const bigBlindIndex = useMatchViewStore((state) => state.bigBlindIndex)
  const matchComplete = useMatchViewStore((state) => state.matchComplete)
  const winnerAgentId = useMatchViewStore((state) => state.winnerAgentId)
  const werewolfDay = useMatchViewStore((state) => state.werewolf.day)
  const werewolfPhase = useMatchViewStore((state) => state.werewolf.phase)

  const thinkingBuffer = useRef<Record<string, string>>({})
  const thinkingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flushThinking = useCallback(() => {
    if (thinkingTimer.current) {
      clearTimeout(thinkingTimer.current)
      thinkingTimer.current = null
    }
    const buffer = thinkingBuffer.current
    thinkingBuffer.current = {}
    for (const [agentId, delta] of Object.entries(buffer)) {
      if (delta) appendThinking(agentId, nameOf(agentId), handNumber, delta)
    }
  }, [appendThinking, handNumber, nameOf])

  useEffect(() => {
    return () => {
      flushThinking()
    }
  }, [flushThinking])

  useEffect(() => {
    init({ matchId, players: initialPlayers })
    for (const event of initialEvents) ingestEvent(event)
  }, [ingestEvent, init, initialEvents, initialPlayers, matchId])

  const onMessage = useCallback(
    (raw: unknown) => {
      const message = raw as SseMessage
      switch (message.kind) {
        case 'event': {
          ingestEvent(message.event)
          const actorId = message.event.actorAgentId
          if (actorId) {
            if (
              message.event.kind === 'poker/action' ||
              message.event.kind === 'poker/deal-flop' ||
              message.event.kind === 'poker/deal-turn' ||
              message.event.kind === 'poker/deal-river' ||
              message.event.kind === 'poker/showdown'
            ) {
              finalizeThinking(actorId)
            }
          }
          break
        }
        case 'thinking-delta': {
          const buffer = thinkingBuffer.current
          buffer[message.agentId] = (buffer[message.agentId] ?? '') + message.delta
          if (!thinkingTimer.current) {
            thinkingTimer.current = setTimeout(() => {
              thinkingTimer.current = null
              flushThinking()
            }, THINKING_BATCH_MS)
          }
          break
        }
        case 'match-end':
          flushThinking()
          setMatchEnd(message.winnerAgentId)
          break
      }
    },
    [finalizeThinking, flushThinking, ingestEvent, setMatchEnd],
  )

  useMatchStream(matchId, onMessage)

  if (gameType === 'werewolf') {
    // Werewolf uses the initial players from SSR (seat + displayName) since
    // the store's `players` array is only mutated by poker events.
    const werewolfPlayers = players.length > 0 ? players : initialPlayers
    return (
      <div className="flex flex-col gap-4 px-4 py-8 md:px-8 lg:flex-row">
        <main className="min-w-0 flex-1">
          <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                Spectator View
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">
                狼人杀 · Day {werewolfDay}
              </h1>
              <p className="mt-2 font-mono text-xs text-muted-foreground">{matchId}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{werewolfPhase ?? 'waiting'}</Badge>
              <Badge variant={status === 'running' ? 'default' : 'secondary'}>{status}</Badge>
              {matchComplete ? <Badge>对局结束</Badge> : null}
              {status !== 'running' ? (
                <Link
                  href={`/matches/${matchId}/replay`}
                  className="inline-flex items-center rounded-lg border border-emerald-400/40 bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-200 hover:bg-emerald-400/20"
                >
                  查看回放 →
                </Link>
              ) : null}
            </div>
          </div>

          <WerewolfBoard players={werewolfPlayers} currentActor={currentActor} />
        </main>

        <RightPanel matchId={matchId} gameType={gameType} />
        <WerewolfResultPanel players={werewolfPlayers} />
      </div>
    )
  }

  const winnerName = winnerAgentId
    ? players.find((player) => player.agentId === winnerAgentId)?.displayName ?? winnerAgentId
    : null

  return (
    <div className="flex flex-col gap-4 px-4 py-8 md:px-8 lg:flex-row">
      <main className="min-w-0 flex-1">
        <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-muted-foreground">Spectator View</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">德州扑克 · 第 {handNumber} 手</h1>
            <p className="mt-2 font-mono text-xs text-muted-foreground">{matchId}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{phase}</Badge>
            <Badge variant={status === 'running' ? 'default' : 'secondary'}>{status}</Badge>
            {matchComplete ? <Badge>对局结束</Badge> : null}
            <FinishAfterHandButton matchId={matchId} status={status} />
            {status !== 'running' ? (
              <Link
                href={`/matches/${matchId}/replay`}
                className="inline-flex items-center rounded-lg border border-cyan-300/40 bg-cyan-300/10 px-3 py-1 text-xs font-semibold text-cyan-100 hover:bg-cyan-300/20"
              >
                查看回放 →
              </Link>
            ) : null}
          </div>
        </div>

        <PokerBoard
          players={players}
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

        {matchComplete ? (
          <div className="mx-auto mt-8 max-w-xl rounded-lg border border-cyan-300/20 bg-cyan-300/10 p-6 text-center shadow-2xl shadow-cyan-950/30">
            <div className="text-2xl font-black text-white">对局结束</div>
            {winnerName ? <div className="mt-2 text-sm text-cyan-100/80">获胜者：{winnerName}</div> : null}
          </div>
        ) : null}
      </main>

      <RightPanel matchId={matchId} gameType={gameType} startingChips={initialChips} />
      <RankingPanel initialChips={initialChips} />
    </div>
  )
}
