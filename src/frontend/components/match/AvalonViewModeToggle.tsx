'use client'

import { Eye, EyeOff, User } from 'lucide-react'
import { useMatchViewStore } from '@/frontend/store/match-view-store'
import { avalonPerspectiveOf } from '@/frontend/store/projections/avalon-v2'

/**
 * 阿瓦隆三视角切换（avalon-frontend PRD §5.2 / AVR-205）：上帝（默认）/
 * 公开 / 单玩家。复用平台 viewMode（god/public 二元开关）+ 阿瓦隆聚焦玩家
 * 叠加出第三视角（avalonPerspectiveOf）——切角不丢进度（累积器全量真相，
 * 剥离只发生在 deriveAvalonView 选择器）。
 */
export function AvalonViewModeToggle() {
  const viewMode = useMatchViewStore((state) => state.viewMode)
  const setViewMode = useMatchViewStore((state) => state.setViewMode)
  const focusPlayerId = useMatchViewStore((state) => state.avalonFocusPlayerId)
  const setAvalonFocusPlayer = useMatchViewStore((state) => state.setAvalonFocusPlayer)
  const avalonV2 = useMatchViewStore((state) => state.avalonV2)
  const players = useMatchViewStore((state) => state.players)

  const perspective = avalonPerspectiveOf(viewMode, focusPlayerId)

  const selectMode = (mode: 'god' | 'public' | 'player') => {
    if (mode === 'public') {
      setAvalonFocusPlayer(null)
      setViewMode('public')
      return
    }
    setViewMode('god')
    if (mode === 'god') {
      setAvalonFocusPlayer(null)
      return
    }
    // 单玩家：默认聚焦 1 号位（无聚焦时）；已聚焦则保持。
    if (!focusPlayerId) {
      const first = avalonV2.seats[0]?.playerId ?? players[0]?.agentId ?? null
      setAvalonFocusPlayer(first)
    }
  }

  const roster =
    avalonV2.seats.length > 0
      ? avalonV2.seats
      : players.map((player, index) => ({ seat: index + 1, playerId: player.agentId }))

  const options = [
    { value: 'god' as const, label: '上帝', icon: Eye },
    { value: 'public' as const, label: '公开', icon: EyeOff },
    { value: 'player' as const, label: '单玩家', icon: User },
  ]

  return (
    <div className="flex items-center gap-1" role="group" aria-label="观战视角" data-testid="avalon-view-mode-toggle" data-active={perspective}>
      {options.map((option) => {
        const active = perspective === option.value
        const Icon = option.icon
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => selectMode(option.value)}
            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold transition-colors ${
              active ? 'bg-white/12 text-white' : 'text-muted-foreground hover:text-slate-200'
            } ${option.value === 'player' ? 'rounded-r-none' : ''}`}
          >
            <Icon size={12} aria-hidden="true" />
            <span>{option.label}</span>
          </button>
        )
      })}
      {perspective === 'player' ? (
        <select
          value={focusPlayerId ?? ''}
          onChange={(event) => setAvalonFocusPlayer(event.target.value || null)}
          className="rounded-md border border-white/15 bg-slate-950/60 px-1.5 py-1 text-xs text-slate-200"
          aria-label="单玩家视角选择玩家"
          data-testid="avalon-focus-player-select"
        >
          {roster.map((seat) => {
            const name = players.find((player) => player.agentId === seat.playerId)?.displayName ?? seat.playerId
            return (
              <option key={seat.playerId} value={seat.playerId}>
                #{seat.seat} {name}
              </option>
            )
          })}
        </select>
      ) : null}
    </div>
  )
}
