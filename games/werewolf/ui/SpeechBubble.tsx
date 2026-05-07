'use client'

import { useEffect, useRef } from 'react'
import { useMatchViewStore } from '@/store/match-view-store'

const ROLE_ZH: Record<string, string> = {
  werewolf: '狼人',
  seer: '预言家',
  witch: '女巫',
  villager: '平民',
}

export function SpeechBubbleList() {
  const speeches = useMatchViewStore((s) => s.werewolf.speechLog)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || typeof el.scrollTo !== 'function') return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [speeches.length])

  return (
    <div
      ref={ref}
      className="h-full space-y-3 overflow-y-auto rounded-lg border border-neutral-800 bg-neutral-950/60 p-3"
      data-testid="werewolf-speech-list"
    >
      {speeches.length === 0 ? (
        <div className="flex h-full min-h-[160px] items-center justify-center text-sm text-neutral-500">
          暂无发言
        </div>
      ) : null}
      {speeches.map((s, i) => (
        <div key={`${s.day}-${s.agentId}-${i}`} className="flex gap-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-700 text-xs font-bold text-white">
            {s.agentId.slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1 rounded-lg border border-neutral-800 bg-neutral-900 p-2">
            <div className="mb-1 flex flex-wrap items-center gap-2 text-[10px] text-neutral-500">
              <span>Day {s.day}</span>
              <span className="font-mono font-semibold text-neutral-400">{s.agentId}</span>
              {s.claimedRole ? (
                <span className="rounded bg-amber-500/15 px-1 text-amber-300">
                  自称 {ROLE_ZH[s.claimedRole] ?? s.claimedRole}
                </span>
              ) : null}
            </div>
            <div className="whitespace-pre-wrap break-words text-sm text-neutral-200">
              {s.content}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
