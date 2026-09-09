'use client'

import { Crown, LoaderCircle } from 'lucide-react'
import type { PokerUiPlayer } from '@/frontend/store/match-view-store'
import {
  avalonCurrentTeamOf,
  avalonFactionOfRole,
  type AvalonV2Accumulator,
  type AvalonView,
} from '@/frontend/store/projections/avalon-v2'
import { avalonRoleZh } from './avalon-format'

/**
 * 阿瓦隆座位卡（avalon-frontend PRD §2.2，AF-OD-1 横排卡组形态）：
 * 座位号 / 名称 / 队长徽标 / 待行动高亮（含思考中）/ 视角相关角色徽标 /
 * 表决立场迷你时间线（每轮一色点）/ 个人可追溯摘要（发言数 · 被提名 · 任务参与）。
 * 纯 props 呈现组件——数据构建见 buildAvalonSeatCards（单测共用）。
 */

export type AvalonSeatCardData = {
  playerId: string
  seat: number
  name: string
  avatarEmoji: string
  isLeader: boolean
  isPending: boolean
  thinking: boolean
  /** 视角可见角色（null = 终局前不可见视角）。 */
  role: string | null
  faction: 'good' | 'evil' | null
  /** 每轮表决立场（下标 = 轮-1；null = 该轮未参与表决的记名票）。 */
  voteTimeline: Array<boolean | null>
  statementCount: number
  nominatedCount: number
  questRounds: Array<{ round: number; outcome: 'pending' | 'ongoing' | 'success' | 'fail' }>
  onQuest: boolean
}

const FACTION_BADGE: Record<'good' | 'evil', string> = {
  good: 'text-sky-200 bg-sky-500/15 border-sky-400/40',
  evil: 'text-rose-200 bg-rose-500/15 border-rose-400/40',
}

/** 每轮「有汇总的最后一次表决」里该玩家的立场（公开记名票，AVR-107）。 */
function buildVoteTimelines(acc: AvalonV2Accumulator): Map<string, Array<boolean | null>> {
  const questCount = acc.quests.length
  const timelines = new Map<string, Array<boolean | null>>()
  for (const seat of acc.seats) timelines.set(seat.playerId, Array.from({ length: questCount }, () => null))
  for (let round = 1; round <= questCount; round += 1) {
    const tally = [...acc.voteTallies].reverse().find((candidate) => candidate.round === round)
    if (!tally) continue
    for (const record of acc.voteRecords) {
      if (record.round !== tally.round || record.attempt !== tally.attempt) continue
      const timeline = timelines.get(record.voterId)
      if (timeline) timeline[round - 1] = record.approve
    }
  }
  return timelines
}

/** 每轮成功获批的任务队伍（轮 → 队伍）。 */
function buildApprovedTeams(acc: AvalonV2Accumulator): Map<number, string[]> {
  const teams = new Map<number, string[]>()
  for (const tally of acc.voteTallies) {
    if (tally.outcome !== 'approved') continue
    const proposal = acc.proposals.find((candidate) => candidate.round === tally.round && candidate.attempt === tally.attempt)
    if (proposal) teams.set(tally.round, proposal.teamIds)
  }
  return teams
}

/** 从 accumulator + 名册构建座位卡数据（纯函数，供组件与单测共用）。 */
export function buildAvalonSeatCards(
  acc: AvalonV2Accumulator,
  view: AvalonView,
  players: PokerUiPlayer[],
  thinkingAgentIds: ReadonlySet<string>,
): AvalonSeatCardData[] {
  const rows =
    acc.seats.length > 0
      ? acc.seats.map((seat) => ({
          seat: seat.seat,
          player: players.find((candidate) => candidate.agentId === seat.playerId) ?? null,
          playerId: seat.playerId,
        }))
      : players.map((player, index) => ({ seat: index + 1, player, playerId: player.agentId }))

  const timelines = buildVoteTimelines(acc)
  const approvedTeams = buildApprovedTeams(acc)
  const currentTeam = avalonCurrentTeamOf(acc)
  const pending = new Set(view.pendingActors)

  return rows.map(({ seat, player, playerId }) => {
    const role = view.visibleRoles[playerId] ?? null
    const questRounds: AvalonSeatCardData['questRounds'] = []
    for (const quest of acc.quests) {
      const team = approvedTeams.get(quest.round)
      if (team?.includes(playerId)) questRounds.push({ round: quest.round, outcome: quest.status })
    }
    return {
      playerId,
      seat,
      name: player?.displayName ?? playerId,
      avatarEmoji: player?.avatarEmoji ?? '🛡',
      isLeader: acc.leaderId === playerId,
      isPending: pending.has(playerId),
      thinking: thinkingAgentIds.has(playerId),
      role,
      faction: role ? avalonFactionOfRole(role) : null,
      voteTimeline: timelines.get(playerId) ?? [],
      statementCount: acc.statements.filter(
        (statement) => statement.kind === 'discussion' && statement.speakerId === playerId,
      ).length,
      nominatedCount: acc.proposals.filter((proposal) => proposal.teamIds.includes(playerId)).length,
      questRounds,
      onQuest: currentTeam.includes(playerId),
    }
  })
}

export function AvalonSeatCardView({ card }: { card: AvalonSeatCardData }) {
  const border = card.isPending
    ? 'border-emerald-400 ring-2 ring-emerald-400/40'
    : card.onQuest
      ? 'border-cyan-300/50'
      : 'border-white/10'
  return (
    <div
      data-testid={`avalon-seat-card-${card.playerId}`}
      data-pending={card.isPending}
      className={`relative min-w-0 rounded-lg border bg-slate-950/60 p-2.5 transition-shadow ${border}`}
    >
      {card.thinking ? (
        <div className="absolute -top-2 left-2 z-10 inline-flex items-center gap-1 rounded-full border border-cyan-200/25 bg-slate-950/95 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-100">
          <LoaderCircle size={10} className="animate-spin" aria-hidden="true" />
          思考中
        </div>
      ) : null}
      <div className="flex items-center gap-2">
        <span className="w-6 shrink-0 font-mono text-xs text-muted-foreground" aria-label={`座位 ${card.seat}`}>
          #{card.seat}
        </span>
        <span className="text-lg leading-none" aria-hidden="true">
          {card.avatarEmoji}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-100">{card.name}</span>
        {card.isLeader ? (
          <span
            className="inline-flex items-center gap-0.5 rounded border border-amber-400/50 bg-amber-500/15 px-1 py-0.5 text-[10px] font-semibold text-amber-200"
            title="本轮轮值队长"
            aria-label="队长"
          >
            <Crown size={10} aria-hidden="true" />
            队长
          </span>
        ) : null}
      </div>

      {card.role ? (
        <span
          className={`mt-1.5 inline-block rounded border px-1.5 py-0.5 text-[10px] font-semibold ${
            card.faction ? FACTION_BADGE[card.faction] : 'border-white/10 bg-white/5 text-slate-200'
          }`}
          data-testid={`avalon-role-${card.playerId}`}
        >
          {avalonRoleZh(card.role)}
        </span>
      ) : (
        <span className="mt-1.5 inline-block rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-muted-foreground">
          身份未揭示
        </span>
      )}

      {/* 表决立场迷你时间线：每轮一色点（赞成 emerald / 反对 rose / 未票 hollow）。 */}
      <div className="mt-2 flex items-center gap-1" aria-label="表决立场时间线">
        {card.voteTimeline.map((approve, index) => (
          <span
            key={index}
            title={`第 ${index + 1} 轮：${approve === null ? '未记票' : approve ? '赞成' : '反对'}`}
            className={`inline-block h-2 w-2 rounded-full border ${
              approve === null
                ? 'border-white/20 bg-transparent'
                : approve
                  ? 'border-emerald-400 bg-emerald-400'
                  : 'border-rose-400 bg-rose-400'
            }`}
          />
        ))}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10px] text-muted-foreground">
        <span>发言 {card.statementCount}</span>
        <span>被提名 {card.nominatedCount}</span>
        <span>
          任务{' '}
          {card.questRounds.length > 0
            ? card.questRounds
                .map((quest) => `R${quest.round}${quest.outcome === 'success' ? '✓' : quest.outcome === 'fail' ? '✗' : quest.outcome === 'ongoing' ? '…' : '·'}`)
                .join(' ')
            : '—'}
        </span>
      </div>
    </div>
  )
}
