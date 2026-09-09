'use client'

import { useMemo } from 'react'
import { useMatchViewStore } from '@/frontend/store/match-view-store'
import {
  avalonPerspectiveOf,
  avalonRejectionCountOf,
  avalonScoreOf,
  avalonTeamText,
  deriveAvalonView,
  type AvalonView,
  type AvalonV2Accumulator,
} from '@/frontend/store/projections/avalon-v2'
import { avalonPhaseZh, avalonRoleZh } from './avalon-format'

/**
 * 阿瓦隆右栏「状态」tab：阶段 / 轮次 / 连坐 / 队长 / 赛点 / 视角。
 * 呈现层为纯 props（AvalonStatusView），store 连接 + 视角选择器在此完成。
 */
export function AvalonStatusPanel() {
  const acc = useMatchViewStore((state) => state.avalonV2)
  const players = useMatchViewStore((state) => state.players)
  const viewMode = useMatchViewStore((state) => state.viewMode)
  const focusPlayerId = useMatchViewStore((state) => state.avalonFocusPlayerId)
  const nameOf = (agentId: string) => players.find((player) => player.agentId === agentId)?.displayName ?? agentId
  return (
    <AvalonStatusView
      acc={acc}
      perspective={avalonPerspectiveOf(viewMode, focusPlayerId)}
      nameOf={nameOf}
    />
  )
}

export function AvalonStatusView({
  acc,
  perspective,
  nameOf,
}: {
  acc: AvalonV2Accumulator
  perspective: AvalonView['perspective']
  nameOf: (agentId: string) => string
}) {
  const { successes, fails } = avalonScoreOf(acc)
  const rejectionCount = avalonRejectionCountOf(acc)
  const perspectiveZh = perspective === 'god' ? '上帝' : perspective === 'public' ? '公开' : '单玩家'

  const stats: Array<{ label: string; value: string; accent?: boolean }> = [
    { label: '当前阶段', value: avalonPhaseZh(acc.phase), accent: true },
    { label: '轮次 / 提案', value: acc.round > 0 ? `第 ${acc.round} 轮 · 第 ${acc.attempt} 次` : '未开局' },
    { label: '任务比分', value: `${successes} : ${fails}（3 胜制）` },
    { label: '连坐计数', value: `${rejectionCount} / 5${rejectionCount >= 4 && acc.ended === null ? '（赛点）' : ''}` },
    { label: '轮值队长', value: acc.leaderId ? nameOf(acc.leaderId) : '—' },
    { label: '板子', value: acc.boardName ?? acc.boardId ?? '—' },
    { label: '观战视角', value: perspectiveZh },
    { label: '状态', value: acc.status === 'settled' ? '已结束' : acc.status === 'live' ? '进行中' : '等待' },
  ]

  return (
    <div className="thin-scrollbar h-full min-h-0 space-y-3 overflow-y-auto" data-testid="avalon-status-panel">
      <div className="grid grid-cols-2 gap-2">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className={`rounded-lg border p-2.5 ${stat.accent ? 'border-cyan-300/30 bg-cyan-300/5' : 'border-white/10 bg-slate-950/45'}`}
          >
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{stat.label}</div>
            <div className={`mt-1 truncate text-sm font-semibold ${stat.accent ? 'text-cyan-100' : 'text-slate-100'}`}>
              {stat.value}
            </div>
          </div>
        ))}
      </div>
      <div className="rounded-lg border border-white/10 bg-slate-950/45 p-2.5">
        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">当前任务队伍</div>
        <div className="mt-1 text-sm font-semibold text-emerald-200">{avalonTeamText(acc, nameOf)}</div>
      </div>
      {acc.ended ? (
        <div className="rounded-lg border border-amber-400/40 bg-amber-500/10 p-3 text-center text-base font-bold text-amber-100">
          {acc.ended.winner === 'good' ? '好人阵营胜利' : acc.ended.winner === 'evil' ? '坏人阵营胜利' : '平局'}
          <span className="ml-2 text-xs font-normal opacity-80">{acc.ended.basis}</span>
        </div>
      ) : null}
    </div>
  )
}

/**
 * 阿瓦隆右栏「名册」tab：座位 + 视角相关角色 + 发言摘要。
 */
export function AvalonRosterPanel() {
  const acc = useMatchViewStore((state) => state.avalonV2)
  const players = useMatchViewStore((state) => state.players)
  const viewMode = useMatchViewStore((state) => state.viewMode)
  const focusPlayerId = useMatchViewStore((state) => state.avalonFocusPlayerId)
  const view = useMemo(
    () => deriveAvalonView(acc, avalonPerspectiveOf(viewMode, focusPlayerId), focusPlayerId),
    [acc, viewMode, focusPlayerId],
  )
  const nameOf = (agentId: string) => players.find((player) => player.agentId === agentId)?.displayName ?? agentId
  return <AvalonRosterView acc={acc} view={view} nameOf={nameOf} />
}

export function AvalonRosterView({
  acc,
  view,
  nameOf,
}: {
  acc: AvalonV2Accumulator
  view: AvalonView
  nameOf: (agentId: string) => string
}) {
  return (
    <div className="thin-scrollbar h-full min-h-0 overflow-y-auto" data-testid="avalon-roster-panel">
      <ul className="space-y-1">
        {acc.seats.map((seat) => {
          const role = view.visibleRoles[seat.playerId]
          const isLeader = acc.leaderId === seat.playerId
          return (
            <li key={seat.playerId} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-white/5">
              <span className="w-6 font-mono text-xs text-muted-foreground">#{seat.seat}</span>
              <span className="min-w-0 flex-1 truncate text-slate-100">
                {nameOf(seat.playerId)}
                {isLeader ? <span className="ml-1 text-[10px] text-amber-200">队长</span> : null}
              </span>
              <span className="font-mono text-[10px] text-muted-foreground">
                {acc.statements.filter((statement) => statement.kind === 'discussion' && statement.speakerId === seat.playerId).length} 发言
              </span>
              {role ? <span className="text-[10px] font-semibold text-violet-200">{avalonRoleZh(role)}</span> : null}
            </li>
          )
        })}
        {acc.seats.length === 0 ? <li className="px-2 py-1.5 text-xs text-muted-foreground">等待开局名册…</li> : null}
      </ul>
    </div>
  )
}
