'use client'

import type { GameEvent } from '@/platform/core/types'
import type { PokerUiPlayer } from '@/frontend/store/match-view-store'

type Snapshot = {
  handNumber: number
  chips: Record<string, number>
}

const COLORS = ['bg-cyan-300', 'bg-violet-300', 'bg-amber-300', 'bg-rose-300', 'bg-emerald-300', 'bg-blue-300']

export function ReplaySummaryPanel({
  gameType,
  players,
  events,
  initialChips,
}: {
  gameType: 'poker' | 'werewolf'
  players: PokerUiPlayer[]
  events: GameEvent[]
  initialChips: number
}) {
  if (gameType !== 'poker') return null

  const snapshots = extractPokerSnapshots(events)
  if (snapshots.length === 0) return null

  const finalSnapshot = snapshots.at(-1)
  if (!finalSnapshot) return null

  const ranked = [...players].sort(
    (a, b) => (finalSnapshot.chips[b.agentId] ?? b.chips) - (finalSnapshot.chips[a.agentId] ?? a.chips),
  )
  const maxStack = Math.max(1, ...snapshots.flatMap((snapshot) => Object.values(snapshot.chips)))

  return (
    <section className="mt-6 grid gap-4 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
      <div className="rounded-2xl border border-border bg-slate-950/45 p-4">
        <div className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">终局排名</div>
        <div className="space-y-2">
          {ranked.map((player, index) => {
            const chips = finalSnapshot.chips[player.agentId] ?? player.chips
            const delta = chips - initialChips
            return (
              <div key={player.agentId} className="flex items-center gap-3 rounded-xl border border-border bg-slate-900/55 px-3 py-2">
                <div className="w-8 text-sm font-bold text-cyan-100">#{index + 1}</div>
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-cyan-300/15 text-sm">
                  {player.avatarEmoji}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-white">{player.displayName}</div>
                  <div className="text-xs text-muted-foreground">最终筹码 ${chips}</div>
                </div>
                <div className={`font-mono text-xs ${delta >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                  {delta >= 0 ? '+' : ''}
                  {delta}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-slate-950/45 p-4">
        <div className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">筹码曲线</div>
        <div className="space-y-3">
          {snapshots.map((snapshot) => (
            <div key={snapshot.handNumber} className="grid gap-2">
              <div className="text-xs font-medium text-cyan-100">第 {snapshot.handNumber} 手</div>
              <div className="space-y-1.5">
                {players.map((player, index) => {
                  const chips = snapshot.chips[player.agentId] ?? 0
                  return (
                    <div key={player.agentId} className="grid grid-cols-[5rem_minmax(0,1fr)_3rem] items-center gap-2 text-xs">
                      <div className="truncate text-muted-foreground">{player.displayName}</div>
                      <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                        <div
                          className={`h-full rounded-full ${COLORS[index % COLORS.length]}`}
                          style={{ width: `${Math.max(3, (chips / maxStack) * 100)}%` }}
                        />
                      </div>
                      <div className="text-right font-mono text-cyan-50">${chips}</div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function extractPokerSnapshots(events: GameEvent[]): Snapshot[] {
  const byHand = new Map<number, Snapshot>()

  for (const event of events) {
    if (event.kind !== 'poker/state') continue
    const handNumber = typeof event.payload.handNumber === 'number' ? event.payload.handNumber : null
    const rawPlayers = Array.isArray(event.payload.players) ? event.payload.players : null
    if (!handNumber || !rawPlayers) continue

    const chips: Record<string, number> = {}
    for (const rawPlayer of rawPlayers) {
      if (!rawPlayer || typeof rawPlayer !== 'object') continue
      const player = rawPlayer as Record<string, unknown>
      const id = typeof player.id === 'string' ? player.id : null
      const stack = typeof player.chips === 'number' ? player.chips : null
      if (id && stack !== null) chips[id] = stack
    }

    if (Object.keys(chips).length > 0) byHand.set(handNumber, { handNumber, chips })
  }

  return [...byHand.values()].sort((a, b) => a.handNumber - b.handNumber)
}
