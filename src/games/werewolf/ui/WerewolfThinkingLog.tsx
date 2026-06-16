'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useMatchViewStore } from '@/frontend/store/match-view-store'
import { useThinkingStore, type ThinkingEntry } from '@/frontend/store/thinking-store'
import { Badge } from '@/frontend/components/ui/badge'
import { Button } from '@/frontend/components/ui/button'

const MAX_THINKING_LENGTH = 4000
const SCROLL_THRESHOLD_PX = 48
const SECTION_HEADERS = /^(观察|分析|计划|决策|总结|推理|Observation|Analysis|Plan|Decision|Summary|Reasoning|Thoughts)[：:]?$/gim

type ThinkingSection = { title: string; body: string }

function parseThinking(text: string): ThinkingSection[] {
  const trimmed = text.trim()
  if (!trimmed) return []

  const matches = Array.from(trimmed.matchAll(SECTION_HEADERS))
  if (matches.length === 0) {
    const parts = trimmed.split(/\n\s*\n/).filter((p) => p.trim().length > 0)
    return parts.map((body, index) => ({
      title: index === 0 ? '思考' : `段落 ${index + 1}`,
      body: body.trim(),
    }))
  }

  const sections: ThinkingSection[] = []
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i]
    const title = match[1]?.trim() ?? '思考'
    const start = match.index ?? 0
    if (i === 0 && start > 0) {
      const preface = trimmed.slice(0, start).trim()
      if (preface.length > 0) sections.push({ title: '前言', body: preface })
    }
    const end = matches[i + 1] ? (matches[i + 1].index ?? trimmed.length) : trimmed.length
    const body = trimmed.slice(start + match[0].length, end).trim()
    sections.push({ title, body })
  }
  return sections
}

function extractActionTag(text: string): string | null {
  const match = text.match(/<action>([\s\S]*?)<\/action>/i)
  if (!match) return null
  try {
    const parsed = JSON.parse(match[1].trim())
    if (parsed?.type && typeof parsed.type === 'string') return parsed.type
    if (typeof parsed === 'string') return parsed
  } catch {
    return match[1].trim()
  }
  return null
}

const ACTION_TYPE_ZH: Record<string, string> = {
  'night/werewolfKill': '夜刀',
  'night/seerCheck': '查验',
  'night/witchSave': '救药',
  'night/witchPoison': '毒药',
  'day/speak': '发言',
  'day/vote': '投票',
}

function formatActionType(type: string | null): string {
  if (!type) return ''
  return ACTION_TYPE_ZH[type] ?? type
}

/**
 * Group label for a thinking entry. Werewolf `state.day` only increments on
 * the night→day transition, so a night phase with `day=N` is「第 N+1 夜」and
 * a day phase with `day=N` is「第 N 天」. Entries without a day (legacy /
 * pre-injection) fall back to「实时」.
 */
function dayLabel(day: number | undefined, phase: string | undefined): string {
  if (day === undefined) return '实时'
  const isNight = phase?.startsWith('night/') ?? false
  return isNight ? `第 ${day + 1} 夜` : `第 ${day} 天`
}

/** Sort + group key: night(day=N) and day(day=N) are different buckets even
 *  if they share a numeric day, so we tag the bucket with night/day. */
function bucketId(day: number | undefined, phase: string | undefined): string {
  if (day === undefined) return 'live'
  return `${day}:${phase?.startsWith('night/') ? 'n' : 'd'}`
}

function ThinkingEntryCard({ entry }: { entry: ThinkingEntry }) {
  const [expanded, setExpanded] = useState(true)
  const sections = useMemo(() => parseThinking(entry.text), [entry.text])
  const actionTag = useMemo(() => extractActionTag(entry.text), [entry.text])
  const displayText = entry.text.length > MAX_THINKING_LENGTH ? `${entry.text.slice(0, MAX_THINKING_LENGTH)}…` : entry.text
  const needsTruncate = entry.text.length > MAX_THINKING_LENGTH

  return (
    <li className="rounded-xl border border-white/10 bg-slate-900/50 p-3">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-slate-100">{entry.displayName}</span>
            {actionTag ? (
              <Badge variant="outline" className="border-cyan-300/30 text-cyan-100">
                决策：{formatActionType(actionTag)}
              </Badge>
            ) : null}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0 text-muted-foreground hover:text-slate-100"
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? '收起' : '展开'}
        >
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </Button>
      </div>

      {expanded && (
        <div className="space-y-2">
          {sections.length > 1 ? (
            sections.map((section, idx) => (
              <div key={idx} className="rounded-lg bg-black/20 p-2">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-200/80">
                  {section.title}
                </div>
                <div className="whitespace-pre-wrap break-words text-xs leading-5 text-slate-300">{section.body}</div>
              </div>
            ))
          ) : (
            <div className="whitespace-pre-wrap break-words text-xs leading-5 text-slate-300">
              {needsTruncate ? displayText : entry.text}
            </div>
          )}
        </div>
      )}
    </li>
  )
}

export function WerewolfThinkingLog() {
  const current = useThinkingStore((s) => s.current)
  const history = useThinkingStore((s) => s.history)
  const day = useMatchViewStore((s) => s.werewolf.day)
  const phase = useMatchViewStore((s) => s.werewolf.phase)
  const historyRef = useRef<HTMLDivElement>(null)

  const currentEntries = useMemo(
    () =>
      Object.entries(current)
        .filter(([, item]) => item.text.trim().length > 0)
        .map(([agentId, item]) => ({
          agentId,
          displayName: item.displayName,
          handNumber: item.handNumber,
          day: item.day,
          phase: item.phase,
          text: item.text,
          at: Date.now(),
        }))
        .reverse(),
    [current],
  )

  // Group history by day bucket (oldest first), newest entry on top within a bucket.
  const grouped = useMemo(() => {
    const map = new Map<string, { label: string; entries: ThinkingEntry[] }>()
    for (const entry of history) {
      if (entry.day === undefined) continue
      const id = bucketId(entry.day, entry.phase)
      const existing = map.get(id)
      if (existing) {
        existing.entries.unshift(entry) // newest first within the bucket
      } else {
        map.set(id, { label: dayLabel(entry.day, entry.phase), entries: [entry] })
      }
    }
    // Sort buckets by their day value ascending; night-before-day on same day
    // value is preserved by the bucket id's n/d suffix ordering naturally.
    return Array.from(map.entries())
      .map(([id, group]) => ({ id, ...group }))
      .sort((a, b) => {
        const [ad] = a.id.split(':')
        const [bd] = b.id.split(':')
        return Number(ad) - Number(bd)
      })
  }, [history])

  // Ungrouped (no day) history entries — legacy/edge case, shown last.
  const ungrouped = useMemo(
    () => history.filter((e) => e.day === undefined).reverse(),
    [history],
  )

  useEffect(() => {
    const el = historyRef.current
    if (!el) return
    const nearTop = el.scrollTop <= SCROLL_THRESHOLD_PX
    if (nearTop) el.scrollTo({ top: 0, behavior: 'smooth' })
  }, [grouped.length, currentEntries.length])

  return (
    <div className="flex h-full min-h-0 flex-col gap-2" data-testid="werewolf-thinking-log">
      {currentEntries.length > 0 && (
        <div className="thin-scrollbar max-h-[42%] shrink-0 overflow-y-auto rounded-xl border border-cyan-300/20 bg-cyan-300/[0.06] p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-100">实时思考</span>
            <span className="text-[10px] text-muted-foreground">{dayLabel(day, phase ?? undefined)}</span>
          </div>
          <ul className="space-y-2">
            {currentEntries.map((entry) => (
              <ThinkingEntryCard key={entry.agentId} entry={entry} />
            ))}
          </ul>
        </div>
      )}

      <div
        ref={historyRef}
        className="thin-scrollbar min-h-0 flex-1 overflow-y-auto rounded-lg border border-white/10 bg-slate-950/45 p-3 pr-2 text-xs"
      >
        {grouped.length === 0 && ungrouped.length === 0 && currentEntries.length === 0 ? (
          <div className="text-muted-foreground">等待思考流...</div>
        ) : (
          <div className="space-y-4">
            {grouped.map((group) => (
              <div key={group.id}>
                <div className="sticky top-0 z-10 mb-2 rounded-md border border-cyan-300/15 bg-slate-800/95 px-2 py-1 text-left text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-100">
                  {group.label}
                </div>
                <ul className="space-y-2">
                  {group.entries.map((entry, idx) => (
                    <ThinkingEntryCard
                      key={`${entry.agentId}-${entry.at}-${idx}`}
                      entry={entry}
                    />
                  ))}
                </ul>
              </div>
            ))}
            {ungrouped.length > 0 ? (
              <div>
                <div className="sticky top-0 z-10 mb-2 rounded-md border border-white/10 bg-slate-800/95 px-2 py-1 text-left text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  其他
                </div>
                <ul className="space-y-2">
                  {ungrouped.map((entry, idx) => (
                    <ThinkingEntryCard key={`x-${entry.agentId}-${entry.at}-${idx}`} entry={entry} />
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}
