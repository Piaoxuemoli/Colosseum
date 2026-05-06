'use client'

import { useCallback, useEffect } from 'react'
import { Badge } from '@/components/ui/badge'
import { RightPanel } from '@/components/match/RightPanel'
import { RankingPanel } from '@/components/match/RankingPanel'
import { PokerBoard } from '@/games/poker/ui/PokerBoard'
import { useMatchStream } from '@/lib/client/sse'
import type { GameEvent } from '@/lib/core/types'
import { useMatchViewStore, type PokerUiPlayer } from '@/store/match-view-store'

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
  const appendThinking = useMatchViewStore((state) => state.appendThinking)
  const setMatchEnd = useMatchViewStore((state) => state.setMatchEnd)
  const handNumber = useMatchViewStore((state) => state.handNumber)
  const players = useMatchViewStore((state) => state.players)
  const communityCards = useMatchViewStore((state) => state.communityCards)
  const pot = useMatchViewStore((state) => state.pot)
  const phase = useMatchViewStore((state) => state.phase)
  const currentActor = useMatchViewStore((state) => state.currentActor)
  const dealerIndex = useMatchViewStore((state) => state.dealerIndex)
  const thinkingByAgent = useMatchViewStore((state) => state.thinkingByAgent)
  const matchComplete = useMatchViewStore((state) => state.matchComplete)
  const winnerAgentId = useMatchViewStore((state) => state.winnerAgentId)

  useEffect(() => {
    init({ matchId, players: initialPlayers })
    for (const event of initialEvents) ingestEvent(event)
  }, [ingestEvent, init, initialEvents, initialPlayers, matchId])

  const onMessage = useCallback(
    (raw: unknown) => {
      const message = raw as SseMessage
      switch (message.kind) {
        case 'event':
          ingestEvent(message.event)
          break
        case 'thinking-delta':
          appendThinking(message.agentId, message.delta)
          break
        case 'match-end':
          setMatchEnd(message.winnerAgentId)
          break
      }
    },
    [appendThinking, ingestEvent, setMatchEnd],
  )

  useMatchStream(matchId, onMessage)

  if (gameType !== 'poker') {
    return <div className="p-8 text-muted-foreground">狼人杀观战页将在 Phase 3 实现。</div>
  }

  const winnerName = winnerAgentId
    ? players.find((player) => player.agentId === winnerAgentId)?.displayName ?? winnerAgentId
    : null

  return (
    <div className="flex flex-col gap-4 px-4 py-8 md:px-8 lg:flex-row">
      <main className="min-w-0 flex-1">
        <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-cyan-300">Spectator View</p>
            <h1 className="mt-3 text-3xl font-black tracking-tight text-white">德州扑克 · 第 {handNumber} 手</h1>
            <p className="mt-2 font-mono text-xs text-muted-foreground">{matchId}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{phase}</Badge>
            <Badge variant={status === 'running' ? 'default' : 'secondary'}>{status}</Badge>
            {matchComplete ? <Badge>对局结束</Badge> : null}
          </div>
        </div>

        <PokerBoard
          players={players}
          communityCards={communityCards}
          pot={pot}
          phase={phase}
          currentActor={currentActor}
          dealerIndex={dealerIndex}
          thinkingByAgent={thinkingByAgent}
        />

        {matchComplete ? (
          <div className="mx-auto mt-8 max-w-xl rounded-3xl border border-cyan-300/20 bg-cyan-300/10 p-6 text-center shadow-2xl shadow-cyan-950/30">
            <div className="text-2xl font-black text-white">对局结束</div>
            {winnerName ? <div className="mt-2 text-sm text-cyan-100/80">获胜者：{winnerName}</div> : null}
          </div>
        ) : null}
      </main>

      <RightPanel matchId={matchId} />
      <RankingPanel initialChips={initialChips} />
    </div>
  )
}
