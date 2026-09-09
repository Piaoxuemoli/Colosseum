'use client'

import { useEffect, useMemo, useRef } from 'react'
import { useMatchViewStore } from '@/frontend/store/match-view-store'
import {
  avalonPerspectiveOf,
  deriveAvalonView,
} from '@/frontend/store/projections/avalon-v2'
import { avalonActionText, buildAvalonActionEntries } from './avalon-format'

const SCROLL_THRESHOLD_PX = 48

/**
 * 阿瓦隆右栏「发言流」tab（avalon-frontend PRD §3，默认 tab）：讨论发言 +
 * 记名表决 + 提案 + 任务结果的统一中文动作流（FR-4.4-03 口径），按轮次分组。
 * 密谋内容按视角遮蔽（hidden 条目渲染占位语义，不携带文本）。
 */
export function AvalonActionLog() {
  const acc = useMatchViewStore((state) => state.avalonV2)
  const players = useMatchViewStore((state) => state.players)
  const viewMode = useMatchViewStore((state) => state.viewMode)
  const focusPlayerId = useMatchViewStore((state) => state.avalonFocusPlayerId)
  const historyRef = useRef<HTMLDivElement>(null)

  const view = useMemo(
    () => deriveAvalonView(acc, avalonPerspectiveOf(viewMode, focusPlayerId), focusPlayerId),
    [acc, viewMode, focusPlayerId],
  )
  const entries = useMemo(() => buildAvalonActionEntries(acc, view), [acc, view])
  const nameOf = (agentId: string) => players.find((player) => player.agentId === agentId)?.displayName ?? agentId

  const grouped = useMemo(() => {
    const byRound = new Map<number, typeof entries>()
    for (const entry of entries) {
      const list = byRound.get(entry.round) ?? ([] as typeof entries)
      list.push(entry)
      byRound.set(entry.round, list)
    }
    return Array.from(byRound.entries()).sort((a, b) => a[0] - b[0])
  }, [entries])

  const total = entries.length

  useEffect(() => {
    const el = historyRef.current
    if (!el) return
    const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - SCROLL_THRESHOLD_PX
    if (nearBottom) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [total])

  return (
    <div className="flex h-full min-h-0 flex-col gap-2" data-testid="avalon-action-log">
      <div
        ref={historyRef}
        className="thin-scrollbar min-h-0 flex-1 overflow-y-auto rounded-lg border border-white/10 bg-slate-950/45 p-3 pr-2 text-xs"
      >
        {grouped.length === 0 ? (
          <div className="text-muted-foreground">等待开局…</div>
        ) : (
          <ul className="space-y-4">
            {grouped.map(([round, roundEntries]) => (
              <li key={round}>
                <div className="sticky top-0 z-10 mb-2 rounded-md border border-cyan-300/15 bg-slate-800/95 px-2 py-1 text-left text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-100">
                  第 {round} 轮
                </div>
                <ol className="space-y-1.5 font-mono">
                  {roundEntries.map((entry, index) => (
                    <li
                      key={`${entry.kind}-${index}`}
                      className={`rounded-xl px-3 py-2 transition-colors ${
                        entry.kind === 'statement' && entry.hidden
                          ? 'border border-rose-400/20 bg-rose-500/[0.06] text-rose-200/80'
                          : entry.kind === 'statement'
                            ? 'bg-slate-900/50 text-slate-200'
                            : entry.kind === 'vote' || entry.kind === 'proposal'
                              ? 'text-cyan-200'
                              : entry.kind === 'quest' || entry.kind === 'assassination' || entry.kind === 'ended'
                                ? 'text-amber-200/90'
                                : 'text-slate-200'
                      } ${entry.kind !== 'statement' ? 'bg-slate-900/50 rounded-xl px-3 py-2' : ''}`}
                    >
                      {avalonActionText(entry, nameOf)}
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
