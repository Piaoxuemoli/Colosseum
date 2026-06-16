'use client'

import { useEffect, useMemo, useRef } from 'react'
import { useMatchViewStore } from '@/frontend/store/match-view-store'

const SCROLL_THRESHOLD_PX = 48

const ROLE_ZH: Record<string, string> = {
  werewolf: '狼人',
  seer: '预言家',
  witch: '女巫',
  villager: '平民',
}

const CAUSE_LABEL: Record<string, string> = {
  werewolfKill: '夜刀',
  witchPoison: '毒杀',
  vote: '票出',
}

/**
 * A single time-ordered item in the werewolf day log. `sortKey` preserves the
 * relative order within a day (announcements → speeches → votes → deaths).
 */
type TimelineItem =
  | { kind: 'narration'; day: number; phase: string; text: string }
  | { kind: 'speech'; day: number; agentId: string; content: string; claimedRole?: string }
  | { kind: 'vote'; day: number; voter: string; target: string | null; reason?: string }
  | { kind: 'death'; day: number; agentId: string; cause: string | null }

const PHASE_ZH: Record<string, string> = {
  'night/werewolfDiscussion': '夜 · 狼人商议',
  'night/werewolfKill': '夜 · 狼人行动',
  'night/seerCheck': '夜 · 预言家查验',
  'night/witchAction': '夜 · 女巫抉择',
  'day/announce': '昼 · 天亮公告',
  'day/speak': '昼 · 依次发言',
  'day/vote': '昼 · 全员投票',
  'day/execute': '昼 · 公示出局',
}

function phaseLabel(phase: string): string {
  return PHASE_ZH[phase] ?? phase
}

export function WerewolfActionLog() {
  const ww = useMatchViewStore((s) => s.werewolf)
  const players = useMatchViewStore((s) => s.players)
  const historyRef = useRef<HTMLDivElement>(null)

  const nameOf = (agentId: string | null) =>
    agentId ? players.find((p) => p.agentId === agentId)?.displayName ?? agentId : '系统'

  // Build a flat timeline across all days, then group by day for rendering.
  const grouped = useMemo(() => {
    const items: Array<TimelineItem & { order: number }> = []
    let order = 0

    for (const n of ww.moderatorNarration) {
      items.push({ kind: 'narration', day: n.day, phase: n.phase, text: n.narration, order: order++ })
    }
    for (const s of ww.speechLog) {
      items.push({ kind: 'speech', day: s.day, agentId: s.agentId, content: s.content, claimedRole: s.claimedRole, order: order++ })
    }
    for (const v of ww.voteLog) {
      items.push({ kind: 'vote', day: v.day, voter: v.voter, target: v.target, reason: v.reason, order: order++ })
    }
    for (const d of ww.deaths) {
      items.push({ kind: 'death', day: d.day, agentId: d.agentId, cause: d.cause, order: order++ })
    }

    const byDay = new Map<number, Array<TimelineItem & { order: number }>>()
    for (const it of items) {
      const list = byDay.get(it.day) ?? []
      list.push(it)
      byDay.set(it.day, list)
    }
    // Within a day: narrations first (phase flow), then speeches, then votes, then deaths;
    // ties broken by arrival order.
    const rank = (k: TimelineItem['kind']) => (k === 'narration' ? 0 : k === 'speech' ? 1 : k === 'vote' ? 2 : 3)
    for (const list of byDay.values()) list.sort((a, b) => rank(a.kind) - rank(b.kind) || a.order - b.order)
    return Array.from(byDay.entries()).sort((a, b) => a[0] - b[0])
  }, [ww.moderatorNarration, ww.speechLog, ww.voteLog, ww.deaths])

  const latestDay = grouped.length > 0 ? grouped[grouped.length - 1][0] : null
  const latestItem = grouped.length > 0 ? grouped[grouped.length - 1][1].slice(-1)[0] : null

  useEffect(() => {
    const el = historyRef.current
    if (!el) return
    const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - SCROLL_THRESHOLD_PX
    if (nearBottom) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [ww.speechLog.length, ww.voteLog.length, ww.moderatorNarration.length, ww.deaths.length])

  return (
    <div className="flex h-full min-h-0 flex-col gap-2" data-testid="werewolf-action-log">
      {latestItem ? (
        <div className="shrink-0 rounded-xl border border-cyan-300/20 bg-cyan-300/[0.08] p-3">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200">最近动态</span>
            <span className="text-[10px] text-muted-foreground">Day {latestDay}</span>
          </div>
          <div className="text-sm text-slate-100">
            {describeItem(latestItem, nameOf)}
          </div>
        </div>
      ) : null}

      <div
        ref={historyRef}
        className="thin-scrollbar min-h-0 flex-1 overflow-y-auto rounded-lg border border-white/10 bg-slate-950/45 p-3 pr-2 text-xs"
      >
        {grouped.length === 0 ? (
          <div className="text-muted-foreground">等待天黑...</div>
        ) : (
          <ul className="space-y-4">
            {grouped.map(([day, dayItems]) => (
              <li key={day}>
                <div className="sticky top-0 z-10 mb-2 rounded-md border border-cyan-300/15 bg-slate-800/95 px-2 py-1 text-left text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-100">
                  第 {day} 天
                </div>
                <ol className="space-y-1.5 font-mono">
                  {dayItems.map((it, idx) => {
                    const isLatest = it === latestItem
                    return (
                      <li
                        key={`${it.kind}-${idx}`}
                        className={`rounded-xl px-3 py-2 transition-colors ${
                          isLatest
                            ? 'border border-cyan-300/20 bg-cyan-300/[0.08]'
                            : 'bg-slate-900/50'
                        }`}
                      >
                        <span className={itemColorClass(it.kind)}>{describeItem(it, nameOf)}</span>
                      </li>
                    )
                  })}
                </ol>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function describeItem(
  item: TimelineItem,
  nameOf: (id: string | null) => string,
): string {
  switch (item.kind) {
    case 'narration':
      return `[${phaseLabel(item.phase)}] ${item.text}`
    case 'speech': {
      const claim = item.claimedRole ? `（自称${ROLE_ZH[item.claimedRole] ?? item.claimedRole}）` : ''
      return `${nameOf(item.agentId)}${claim}：${item.content}`
    }
    case 'vote':
      return item.target === null
        ? `${nameOf(item.voter)} 弃票`
        : `${nameOf(item.voter)} → 投 ${nameOf(item.target)}`
    case 'death':
      return item.cause
        ? `${nameOf(item.agentId)} 出局（${CAUSE_LABEL[item.cause] ?? item.cause}）`
        : `${nameOf(item.agentId)} 出局`
  }
}

function itemColorClass(kind: TimelineItem['kind']): string {
  switch (kind) {
    case 'narration':
      return 'text-amber-200/90'
    case 'speech':
      return 'text-slate-200'
    case 'vote':
      return 'text-cyan-200'
    case 'death':
      return 'text-rose-300'
  }
}
