'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef } from 'react'
import { Badge } from '@/frontend/components/ui/badge'
import { FinishAfterHandButton } from '@/frontend/components/match/FinishAfterHandButton'
import { GenericSituationPanel } from '@/frontend/components/match/GenericSituationPanel'
import { MatchKeyStatusBadge } from '@/frontend/components/match/MatchKeyStatusBadge'
import { RightPanel } from '@/frontend/components/match/RightPanel'
import { RankingPanel } from '@/frontend/components/match/RankingPanel'
import { SettlementTrustSection } from '@/frontend/components/match/SettlementTrustSection'
import { ViewModeToggle } from '@/frontend/components/match/ViewModeToggle'
import { PokerBoard } from '@/games/poker/ui/PokerBoard'
import { WerewolfBoard } from '@/games/werewolf/ui/WerewolfBoard'
import { WerewolfResultPanel } from '@/games/werewolf/ui/WerewolfResultPanel'
import { useMatchStream } from '@/frontend/lib/client/sse'
import { thinkingEntryFromEvent } from '@/frontend/lib/client/thinking-events'
import type { GameEvent } from '@/platform/core/types'
import { useMatchViewStore, type PokerUiPlayer } from '@/frontend/store/match-view-store'
import { useThinkingStore } from '@/frontend/store/thinking-store'

const THINKING_BATCH_MS = 80
const THINKING_CURRENT_STALE_MS = 7000

/** FR-4.7-02 赛后解说：agentId → 显示名（mvp 徽标用）。 */
function agentNamesOf(players: PokerUiPlayer[]): Record<string, string> {
  const map: Record<string, string> = {}
  for (const player of players) map[player.agentId] = player.displayName
  return map
}

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
  finalRanking,
}: {
  matchId: string
  /** 品类呈现契约（FR-4.5-03）：未知品类回落通用面板，不阻断观战。 */
  gameType: string
  initialPlayers: PokerUiPlayer[]
  initialEvents: GameEvent[]
  initialChips: number
  status: string
  finalRanking: Record<string, unknown> | null
}) {
  const init = useMatchViewStore((state) => state.init)
  const ingestEvent = useMatchViewStore((state) => state.ingestEvent)
  const setMatchEnd = useMatchViewStore((state) => state.setMatchEnd)
  const appendThinking = useThinkingStore((state) => state.appendThinking)
  const recordThinking = useThinkingStore((state) => state.recordThinking)
  const finalizeThinking = useThinkingStore((state) => state.finalizeThinking)
  const finalizeAllThinking = useThinkingStore((state) => state.finalizeAllThinking)
  const expireStaleThinking = useThinkingStore((state) => state.expireStaleThinking)
  const resetThinking = useThinkingStore((state) => state.reset)

  const handNumber = useMatchViewStore((state) => state.handNumber)
  const players = useMatchViewStore((state) => state.players)

  const nameOf = useCallback((agentId: string) => {
    const currentPlayers = useMatchViewStore.getState().players
    return currentPlayers.find((p) => p.agentId === agentId)?.displayName ?? agentId
  }, [])
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
  const genericV2 = useMatchViewStore((state) => state.genericV2)
  const storeEvents = useMatchViewStore((state) => state.events)

  const thinkingBuffer = useRef<Record<string, string>>({})
  const thinkingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flushThinking = useCallback(() => {
    if (thinkingTimer.current) {
      clearTimeout(thinkingTimer.current)
      thinkingTimer.current = null
    }
    const buffer = thinkingBuffer.current
    thinkingBuffer.current = {}
    // Werewolf reasoning groups by day/phase; poker keeps the legacy
    // handNumber-only path (day undefined).
    const bucket =
      gameType === 'werewolf'
        ? { day: werewolfDay, phase: werewolfPhase ?? undefined }
        : undefined
    for (const [agentId, delta] of Object.entries(buffer)) {
      if (delta) appendThinking(agentId, nameOf(agentId), handNumber, delta, bucket)
    }
  }, [appendThinking, gameType, handNumber, nameOf, werewolfDay, werewolfPhase])

  const ingestViewEvent = useCallback(
    (event: GameEvent) => {
      ingestEvent(event)
      const entry = thinkingEntryFromEvent(event, nameOf(event.actorAgentId ?? ''))
      if (entry) recordThinking(entry)
    },
    [ingestEvent, nameOf, recordThinking],
  )

  useEffect(() => {
    return () => {
      flushThinking()
    }
  }, [flushThinking])

  useEffect(() => {
    const interval = setInterval(() => {
      expireStaleThinking(THINKING_CURRENT_STALE_MS)
    }, 1000)
    return () => clearInterval(interval)
  }, [expireStaleThinking])

  useEffect(() => {
    resetThinking()
    init({ matchId, players: initialPlayers })
    for (const event of initialEvents) ingestViewEvent(event)
  }, [ingestViewEvent, init, initialEvents, initialPlayers, matchId, resetThinking])

  const onMessage = useCallback(
    (raw: unknown) => {
      const message = raw as SseMessage
      switch (message.kind) {
        case 'event': {
          ingestViewEvent(message.event)
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
        case 'agent-action-ready': {
          flushThinking()
          finalizeThinking(message.agentId)
          break
        }
        case 'match-end':
          flushThinking()
          finalizeAllThinking()
          setMatchEnd(message.winnerAgentId)
          break
      }
    },
    [finalizeAllThinking, finalizeThinking, flushThinking, ingestViewEvent, setMatchEnd],
  )

  useMatchStream(matchId, onMessage)

  if (gameType === 'werewolf') {
    // Werewolf uses the initial players from SSR (seat + displayName) since
    // the store's `players` array is only mutated by poker events.
    const werewolfPlayers = players.length > 0 ? players : initialPlayers
    return (
      <div className="flex h-[100dvh] max-h-[100dvh] min-h-0 flex-col gap-3 overflow-hidden px-3 py-3 md:px-5 lg:flex-row lg:p-6">
        <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="mb-3 flex shrink-0 flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                Spectator View
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white lg:text-3xl">
                狼人杀 · Day {werewolfDay}
              </h1>
              <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{matchId}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{werewolfPhase ?? 'waiting'}</Badge>
              <Badge variant={status === 'running' ? 'default' : 'secondary'}>{status}</Badge>
              <ViewModeToggle />
              <MatchKeyStatusBadge matchId={matchId} />
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

          <div className="min-h-0 flex-1 overflow-hidden">
            <WerewolfBoard players={werewolfPlayers} currentActor={currentActor} />
          </div>

          {matchComplete ? (
            <div className="shrink-0">
              <SettlementTrustSection
                matchId={matchId}
                events={storeEvents}
                finalRanking={finalRanking}
                agentNames={agentNamesOf(werewolfPlayers)}
              />
            </div>
          ) : null}
        </main>

        <RightPanel matchId={matchId} gameType="werewolf" />
        <WerewolfResultPanel players={werewolfPlayers} />
      </div>
    )
  }

  if (gameType !== 'poker') {
    // 品类呈现契约兜底（FR-4.5-03 / presentation-contract spec §4）：
    // 无专属棋盘的品类回落通用面板（态势名册 + 阶段条带 + 动作流 + 结算）。
    const genericComplete = genericV2.status === 'settled'
    return (
      <div className="flex h-[100dvh] max-h-[100dvh] min-h-0 flex-col gap-3 overflow-hidden px-3 py-3 md:px-5 lg:flex-row lg:p-6">
        <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="mb-3 flex shrink-0 flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                Spectator View · 通用呈现
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white lg:text-3xl">
                {gameType} · {genericV2.cycle > 0 ? `第 ${genericV2.cycle} 轮` : '等待开局'}
              </h1>
              <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{matchId}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{genericV2.phase ?? 'waiting'}</Badge>
              <Badge variant={status === 'running' ? 'default' : 'secondary'}>{status}</Badge>
              <MatchKeyStatusBadge matchId={matchId} />
              {genericComplete ? <Badge>对局结束</Badge> : null}
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

          <div className="min-h-0 flex-1 overflow-hidden">
            <GenericSituationPanel matchId={matchId} />
          </div>
        </main>
      </div>
    )
  }

  const winnerName = winnerAgentId
    ? players.find((player) => player.agentId === winnerAgentId)?.displayName ?? winnerAgentId
    : null

  return (
    <div className="flex h-[100dvh] max-h-[100dvh] min-h-0 flex-col gap-3 overflow-hidden px-3 py-3 md:px-5 lg:flex-row lg:p-6">
      <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="mb-3 flex shrink-0 flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-muted-foreground">Spectator View</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white lg:text-3xl">德州扑克 · 第 {handNumber} 手</h1>
            <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{matchId}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{phase}</Badge>
            <Badge variant={status === 'running' ? 'default' : 'secondary'}>{status}</Badge>
            <ViewModeToggle />
            <MatchKeyStatusBadge matchId={matchId} />
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

        <div className="min-h-0 flex-1 overflow-hidden">
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
        </div>

        {matchComplete ? (
          <div className="pointer-events-none absolute left-1/2 top-6 z-30 max-w-xl -translate-x-1/2 rounded-lg border border-cyan-300/20 bg-cyan-300/10 px-6 py-4 text-center shadow-2xl shadow-cyan-950/30 backdrop-blur">
            <div className="text-2xl font-black text-white">对局结束</div>
            {winnerName ? <div className="mt-2 text-sm text-cyan-100/80">获胜者：{winnerName}</div> : null}
          </div>
        ) : null}
      </main>

      <RightPanel matchId={matchId} gameType="poker" startingChips={initialChips} />
      <RankingPanel matchId={matchId} initialChips={initialChips} finalRanking={finalRanking} />
    </div>
  )
}
