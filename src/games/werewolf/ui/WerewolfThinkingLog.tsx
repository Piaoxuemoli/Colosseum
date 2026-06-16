'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useMatchViewStore } from '@/frontend/store/match-view-store'
import { useThinkingStore } from '@/frontend/store/thinking-store'
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

function ThinkingEntryCard({
  entry,
}: {
  entry: { agentId: string; displayName: string; text: string }
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
  const phase = useMatchViewStore((s) => s.werewolf.phase)
  const day = useMatchViewStore((s) => s.werewolf.day)
  const historyRef = useRef<HTMLDivElement>(null)

  const currentEntries = useMemo(
    () =>
      Object.entries(current)
        .filter(([, item]) => item.text.trim().length > 0)
        .map(([agentId, item]) => ({ agentId, displayName: item.displayName, text: item.text, at: Date.now() }))
        .reverse(),
    [current],
  )

  // Werewolf has no hands; show history newest-first (most recent reasoning on top).
  const historyEntries = useMemo(() => [...history].reverse(), [history])

  useEffect(() => {
    const el = historyRef.current
    if (!el) return
    const nearTop = el.scrollTop <= SCROLL_THRESHOLD_PX
    if (nearTop && historyEntries.length > 0) {
      el.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }, [historyEntries.length, currentEntries.length])

  return (
    <div className="flex h-full min-h-0 flex-col gap-2" data-testid="werewolf-thinking-log">
      {currentEntries.length > 0 && (
        <div className="thin-scrollbar max-h-[42%] shrink-0 overflow-y-auto rounded-xl border border-cyan-300/20 bg-cyan-300/[0.06] p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-100">实时思考</span>
            <span className="text-[10px] text-muted-foreground">Day {day}{phase ? ` · ${phase}` : ''}</span>
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
        {historyEntries.length === 0 && currentEntries.length === 0 ? (
          <div className="text-muted-foreground">等待思考流...</div>
        ) : (
          <ul className="space-y-2">
            {historyEntries.map((entry, idx) => (
              <ThinkingEntryCard
                key={`${entry.agentId}-${entry.at}-${idx}`}
                entry={{ agentId: entry.agentId, displayName: entry.displayName, text: entry.text }}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
