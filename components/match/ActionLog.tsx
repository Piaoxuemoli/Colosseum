'use client'

import { useEffect, useRef } from 'react'
import { useMatchViewStore } from '@/store/match-view-store'
import type { GameEvent } from '@/lib/core/types'

function formatAmount(value: unknown): string {
  return typeof value === 'number' ? ` ${value}` : ''
}

function describeAction(event: GameEvent): string {
  if (event.kind !== 'poker/action') return event.kind

  const action = event.payload
  const type = typeof action.type === 'string' ? action.type : 'act'
  const actor = event.actorAgentId ?? 'system'

  if (type === 'raise') return `${actor} raise to${formatAmount(action.toAmount ?? action.amount)}`
  if (type === 'allIn') return `${actor} all-in${formatAmount(action.amount ?? action.toAmount)}`
  return `${actor} ${type}${formatAmount(action.amount ?? action.toAmount)}`
}

export function ActionLog() {
  const events = useMatchViewStore((state) => state.events)
  const ref = useRef<HTMLDivElement>(null)
  const actions = events.filter((event) =>
    ['poker/action', 'poker/rejection', 'poker/deal-flop', 'poker/deal-turn', 'poker/deal-river', 'poker/showdown', 'poker/pot-award'].includes(
      event.kind,
    ),
  )

  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: 'smooth' })
  }, [actions.length])

  return (
    <div ref={ref} className="h-56 overflow-y-auto rounded-2xl border border-border bg-slate-950/45 p-3 text-xs">
      {actions.length === 0 ? (
        <div className="text-muted-foreground">等待行动...</div>
      ) : (
        <ol className="space-y-2 font-mono">
          {actions.map((event) => (
            <li key={event.id} className="rounded-xl bg-slate-900/50 px-3 py-2 text-slate-200">
              <span className="mr-2 text-cyan-300/70">#{event.seq}</span>
              {describeAction(event)}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
