'use client'

import { Crown, Eye, ShieldAlert } from 'lucide-react'
import { useMatchViewStore } from '@/frontend/store/match-view-store'

/**
 * 品类呈现契约 · 通用兜底面板（presentation-contract spec §4）。
 *
 * 无专属棋盘的品类（未知 gameType，R3-2 冒烟场景）的紧凑列表呈现：
 * 态势名册 + 阶段条带 + 通用动作日志 + 结算摘要。零品类知识——
 * 全部数据来自 generic-v2 兜底投影，设计 tokens 与既有面板一致。
 */
export function GenericSituationPanel({ matchId }: { matchId: string }) {
  const generic = useMatchViewStore((state) => state.genericV2)
  const players = useMatchViewStore((state) => state.players)

  const nameOf = (agentId: string) =>
    players.find((player) => player.agentId === agentId)?.displayName ?? agentId
  const gameLabel = generic.gameType ?? '未知品类'
  const cycleLabel = generic.cycle > 0 ? `第 ${generic.cycle} 轮` : '未开局'
  const recentLog = generic.log.slice(-80).reverse()

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto" aria-label={`通用观战面板 ${matchId}`}>
      {/* 态势 + 阶段条带 */}
      <section className="shrink-0 rounded-lg border border-white/10 bg-slate-950/45 p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            态势 · {gameLabel}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{cycleLabel}</span>
            {generic.phase ? (
              <span className="rounded border border-white/10 px-1.5 py-0.5 font-mono">{generic.phase}</span>
            ) : null}
            <span>{generic.status === 'settled' ? '已结束' : generic.status === 'live' ? '进行中' : '等待'}</span>
          </div>
        </div>
        <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          {generic.roster.map((row) => (
            <li
              key={row.agentId}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-white/5"
            >
              <div className="w-6 text-xs text-muted-foreground">{row.seat !== null ? `#${row.seat}` : '·'}</div>
              <div className="min-w-0 flex-1 truncate">{nameOf(row.agentId)}</div>
              <div className="font-mono text-xs text-muted-foreground">{row.actionCount} 动作</div>
            </li>
          ))}
          {generic.roster.length === 0 ? (
            <li className="px-2 py-1.5 text-xs text-muted-foreground">尚无名册锚点事件</li>
          ) : null}
        </ul>
        {generic.boundaries.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1 border-t border-white/5 pt-2">
            {generic.boundaries.slice(-10).map((boundary) => (
              <span
                key={`${boundary.seq}-${boundary.phase}`}
                className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
              >
                {boundary.cycle > 0 ? `R${boundary.cycle}·` : ''}
                {boundary.phase || '?'}
              </span>
            ))}
          </div>
        ) : null}
      </section>

      {/* 结算摘要 */}
      {generic.settlement ? (
        <section className="shrink-0 rounded-lg border border-emerald-400/20 bg-emerald-400/5 p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-200">
            <Crown aria-label="winner" size={14} />
            结算 · {generic.settlement.winnerLabel ?? '平局'}
          </div>
          <ol className="space-y-1">
            {generic.settlement.rows.map((row) => (
              <li key={row.agentId} className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-white/5">
                <div className="w-6 text-xs text-muted-foreground">{row.rank ?? '·'}</div>
                <div className="min-w-0 flex-1 truncate">{nameOf(row.agentId)}</div>
                {row.role ? (
                  <span className="font-mono text-xs text-muted-foreground">{row.role}</span>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {/* 通用动作日志（最新在前） */}
      <section className="flex min-h-0 flex-1 flex-col rounded-lg border border-white/10 bg-slate-950/45 p-3">
        <div className="mb-2 shrink-0 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          动作流
        </div>
        <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
          {recentLog.map((entry) => (
            <li
              key={`${entry.seq}-${entry.engineKind}`}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-white/5"
            >
              <div className="w-14 shrink-0 font-mono text-[10px] text-muted-foreground">#{entry.seq}</div>
              <div className="min-w-0 flex-1 truncate">{entry.text}</div>
              {entry.restricted ? (
                <Eye aria-label="受限可见" size={12} className="shrink-0 text-amber-300/80" />
              ) : null}
              {entry.isDefault ? (
                <ShieldAlert aria-label="兜底动作" size={12} className="shrink-0 text-red-300/80" />
              ) : null}
            </li>
          ))}
          {recentLog.length === 0 ? (
            <li className="px-2 py-1.5 text-xs text-muted-foreground">暂无事件</li>
          ) : null}
        </ul>
      </section>
    </div>
  )
}
