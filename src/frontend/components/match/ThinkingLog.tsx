'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useMatchViewStore } from '@/frontend/store/match-view-store'
import { useThinkingStore } from '@/frontend/store/thinking-store'
import { Badge } from '@/frontend/components/ui/badge'
import { Button } from '@/frontend/components/ui/button'

const MAX_THINKING_LENGTH = 4000
const SECTION_HEADERS = /^(观察|分析|计划|决策|总结|推理|Observation|Analysis|Plan|Decision|Summary|Reasoning|Thoughts)[：:]?$/gim

export type ThinkingSection = {
  title: string
  body: string
}

function parseThinking(text: string): ThinkingSection[] {
  const trimmed = text.trim()
  if (!trimmed) return []

  const matches = Array.from(trimmed.matchAll(SECTION_HEADERS))
  if (matches.length === 0) {
    // No explicit sections: split by blank lines.
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
      if (preface.length > 0) {
        sections.push({ title: '前言', body: preface })
      }
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

function formatActionType(type: string | null): string {
  if (!type) return ''
  const map: Record<string, string> = {
    fold: '弃牌',
    check: '过牌',
    call: '跟注',
    bet: '下注',
    raise: '加注',
    allIn: '全下',
    allin: '全下',
    postSmallBlind: '小盲',
    postBigBlind: '大盲',
  }
  return map[type] ?? type
}

function ThinkingEntryCard({
  entry,
  phase,
}: {
  entry: { agentId: string; displayName: string; handNumber: number; text: string; at: number }
  phase?: string
}) {
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
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-200">
              第 {entry.handNumber} 手
            </span>
            <span className="text-sm font-medium text-slate-100">{entry.displayName}</span>
            {actionTag ? (
              <Badge variant="outline" className="border-cyan-300/30 text-cyan-100">
                决策：{formatActionType(actionTag)}
              </Badge>
            ) : null}
          </div>
          {phase ? <div className="mt-0.5 text-[10px] text-muted-foreground">{phase}</div> : null}
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
                <div className="whitespace-pre-wrap text-xs leading-5 text-slate-300">{section.body}</div>
              </div>
            ))
          ) : (
            <div className="whitespace-pre-wrap text-xs leading-5 text-slate-300">
              {needsTruncate ? displayText : entry.text}
            </div>
          )}
        </div>
      )}
    </li>
  )
}

export function ThinkingLog() {
  const current = useThinkingStore((s) => s.current)
  const history = useThinkingStore((s) => s.history)
  const phase = useMatchViewStore((state) => state.phase)
  const ref = useRef<HTMLDivElement>(null)

  const grouped = useMemo(() => {
    const map = new Map<number, Array<{ agentId: string; displayName: string; handNumber: number; text: string; at: number }>>()
    for (const entry of history) {
      const list = map.get(entry.handNumber) ?? []
      list.push(entry)
      map.set(entry.handNumber, list)
    }
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0])
  }, [history])

  const currentEntries = useMemo(
    () =>
      Object.entries(current)
        .filter(([, item]) => item.text.trim().length > 0)
        .map(([agentId, item]) => ({ agentId, ...item })),
    [current],
  )

  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: 'smooth' })
  }, [grouped.length, currentEntries.length])

  return (
    <div ref={ref} className="thin-scrollbar h-full min-h-0 overflow-y-auto rounded-lg border border-white/10 bg-slate-950/45 p-3 pr-2 text-xs">
      {history.length === 0 && currentEntries.length === 0 ? (
        <div className="text-muted-foreground">等待思考流...</div>
      ) : (
        <ul className="space-y-4">
          {currentEntries.length > 0 && (
            <li>
              <div className="sticky top-0 z-10 mb-2 rounded-md border border-cyan-300/15 bg-slate-800/95 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-100">
                当前思考
              </div>
              <ul className="space-y-2">
                {currentEntries.map((entry) => (
                  <li
                    key={entry.agentId}
                    className="rounded-xl border border-cyan-300/20 bg-cyan-300/[0.06] p-3"
                  >
                    <div className="mb-1 text-sm font-medium text-slate-100">{entry.displayName}</div>
                    <div className="whitespace-pre-wrap text-xs leading-5 text-slate-300">{entry.text}</div>
                  </li>
                ))}
              </ul>
            </li>
          )}

          {grouped.map(([handNumber, entries]) => (
            <li key={handNumber}>
              <div className="sticky top-0 z-10 mb-2 rounded-md border border-cyan-300/15 bg-slate-800/95 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-100">
                第 {handNumber} 手
              </div>
              <ul className="space-y-2">
                {entries.map((entry, idx) => (
                  <ThinkingEntryCard key={`${entry.agentId}-${entry.at}-${idx}`} entry={entry} phase={phase} />
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
