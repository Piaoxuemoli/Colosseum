'use client'

import { useEffect, useMemo, useRef } from 'react'
import { useMatchViewStore } from '@/frontend/store/match-view-store'
import type { GameEvent } from '@/platform/core/types'

const RECENT_EVENT_LIMIT = 400

const SUIT_SYMBOLS: Record<string, string> = {
  spades: '♠',
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
  S: '♠',
  H: '♥',
  D: '♦',
  C: '♣',
  s: '♠',
  h: '♥',
  d: '♦',
  c: '♣',
}

function formatCard(card: { rank: string; suit: string }): string {
  return `${SUIT_SYMBOLS[card.suit] ?? card.suit}${card.rank}`
}

function formatAmount(value: unknown): string {
  return typeof value === 'number' ? ` ${value}` : ''
}

function actionColorClass(type: string): string {
  switch (type) {
    case 'fold':
      return 'text-slate-400'
    case 'check':
      return 'text-slate-300'
    case 'call':
      return 'text-emerald-300'
    case 'bet':
    case 'raise':
      return 'text-cyan-300'
    case 'allIn':
      return 'text-rose-300'
    default:
      return 'text-slate-300'
  }
}

function describeAction(event: GameEvent, nameOf: (agentId: string | null) => string): { text: string; className: string } {
  if (event.kind !== 'poker/action') {
    return { text: describeSystemEvent(event), className: 'text-slate-300' }
  }

  const action = event.payload as Record<string, unknown>
  const type = typeof action.type === 'string' ? action.type : 'act'
  const actor = nameOf(event.actorAgentId)
  const amount = formatAmount(action.amount ?? action.toAmount)

  switch (type) {
    case 'fold':
      return { text: `${actor} 弃牌`, className: actionColorClass(type) }
    case 'check':
      return { text: `${actor} 过牌`, className: actionColorClass(type) }
    case 'call':
      return { text: `${actor} 跟注${amount}`, className: actionColorClass(type) }
    case 'bet':
      return { text: `${actor} 下注${amount}`, className: actionColorClass(type) }
    case 'raise':
      return { text: `${actor} 加注到${amount}`, className: actionColorClass(type) }
    case 'allIn':
      return { text: `${actor} 全下${amount}`, className: actionColorClass(type) }
    case 'postSmallBlind':
      return { text: `${actor} 小盲${amount}`, className: 'text-slate-300' }
    case 'postBigBlind':
      return { text: `${actor} 大盲${amount}`, className: 'text-slate-300' }
    default:
      return { text: `${actor} ${type}${amount}`, className: 'text-slate-300' }
  }
}

function describeSystemEvent(event: GameEvent): string {
  const payload = event.payload as Record<string, unknown>

  switch (event.kind) {
    case 'poker/deal-flop': {
      const cards = Array.isArray(payload.cards) ? (payload.cards as Array<{ rank: string; suit: string }>) : []
      return `翻牌：${cards.map(formatCard).join(' ')}`
    }
    case 'poker/deal-turn': {
      const cards = Array.isArray(payload.cards) ? (payload.cards as Array<{ rank: string; suit: string }>) : []
      return `转牌：${cards.map(formatCard).join(' ')}`
    }
    case 'poker/deal-river': {
      const cards = Array.isArray(payload.cards) ? (payload.cards as Array<{ rank: string; suit: string }>) : []
      return `河牌：${cards.map(formatCard).join(' ')}`
    }
    case 'poker/showdown':
      return '摊牌'
    case 'poker/pot-award': {
      const winnerIds = Array.isArray(payload.winnerIds) ? (payload.winnerIds as string[]) : []
      const potAmount = typeof payload.potAmount === 'number' ? payload.potAmount : null
      const amountText = potAmount !== null ? ` ${potAmount}` : ''
      if (winnerIds.length === 0) return `底池分配${amountText}`
      return `底池分配 +${amountText} → ${winnerIds.join(', ')}`
    }
    default:
      return event.kind
  }
}

export function ActionLog() {
  const events = useMatchViewStore((state) => state.events)
  const players = useMatchViewStore((state) => state.players)
  const ref = useRef<HTMLDivElement>(null)

  const actions = useMemo(() => {
    const recent = events.slice(-RECENT_EVENT_LIMIT)
    return recent.filter((event) =>
      [
        'poker/action',
        'poker/rejection',
        'poker/deal-flop',
        'poker/deal-turn',
        'poker/deal-river',
        'poker/showdown',
        'poker/pot-award',
      ].includes(event.kind),
    )
  }, [events])

  const grouped = useMemo(() => {
    const map = new Map<number, typeof actions>()
    for (const event of actions) {
      const hand = (event as GameEvent & { handNumberAt?: number }).handNumberAt ?? 0
      const list = map.get(hand) ?? []
      list.push(event)
      map.set(hand, list)
    }
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0])
  }, [actions])

  useEffect(() => {
    if (typeof ref.current?.scrollTo === 'function') {
      ref.current.scrollTo({ top: ref.current.scrollHeight, behavior: 'smooth' })
    }
  }, [grouped.length, actions.length])

  const nameOf = (agentId: string | null) =>
    agentId ? players.find((player) => player.agentId === agentId)?.displayName ?? agentId : 'system'

  return (
    <div ref={ref} className="thin-scrollbar h-full min-h-0 overflow-y-auto rounded-lg border border-white/10 bg-slate-950/45 p-3 pr-2 text-xs">
      {actions.length === 0 ? (
        <div className="text-muted-foreground">等待行动...</div>
      ) : (
        <ul className="space-y-4">
          {grouped.map(([handNumber, handEvents]) => (
            <li key={handNumber}>
              <div className="sticky top-0 z-10 mb-2 rounded-md border border-cyan-300/15 bg-slate-800/95 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-100">
                第 {handNumber} 手
              </div>
              <ol className="space-y-1.5 font-mono">
                {handEvents.map((event, eventIndex, arr) => {
                  const { text, className } = describeAction(event, nameOf)
                  const isLatest = event.id === actions[actions.length - 1]?.id
                  const isLastInHand = eventIndex === arr.length - 1
                  return (
                    <li
                      key={event.id}
                      className={`rounded-xl px-3 py-2 transition-colors ${
                        isLatest
                          ? 'border border-cyan-300/20 bg-cyan-300/[0.08]'
                          : isLastInHand
                            ? 'bg-slate-900/70'
                            : 'bg-slate-900/50'
                      }`}
                    >
                      <span className="mr-2 text-cyan-300/70">#{event.seq}</span>
                      <span className={className}>{text}</span>
                    </li>
                  )
                })}
              </ol>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
