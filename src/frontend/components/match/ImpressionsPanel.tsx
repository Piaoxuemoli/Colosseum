'use client'

import { useEffect, useMemo, useState } from 'react'
import { Badge } from '@/frontend/components/ui/badge'
import { api } from '@/frontend/lib/client/api'

type ImpressionRow = {
  observerAgentId: string
  observerName: string
  targetAgentId: string
  targetName: string
  gamesObserved: number
  profile: Record<string, unknown>
}

type ImpressionResponse = {
  gameType: 'poker' | 'werewolf'
  participantCount: number
  impressionCount: number
  impressions: ImpressionRow[]
}

function numericProfileValue(profile: Record<string, unknown>, key: string): number | null {
  const value = profile[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function scoreText(value: number | null): string {
  return value === null ? '-' : value.toFixed(1)
}

function profileNote(profile: Record<string, unknown>): string {
  const note = profile.note
  return typeof note === 'string' && note.trim().length > 0 ? note.trim() : '暂无备注'
}

function MetricPill({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-md border border-white/10 bg-black/20 px-2 py-1">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-mono text-xs font-semibold text-cyan-100">{scoreText(value)}</div>
    </div>
  )
}

function PokerProfile({ profile }: { profile: Record<string, unknown> }) {
  return (
    <div className="grid grid-cols-4 gap-1.5">
      <MetricPill label="松紧" value={numericProfileValue(profile, 'looseness')} />
      <MetricPill label="进攻" value={numericProfileValue(profile, 'aggression')} />
      <MetricPill label="粘性" value={numericProfileValue(profile, 'stickiness')} />
      <MetricPill label="诚实" value={numericProfileValue(profile, 'honesty')} />
    </div>
  )
}

function WerewolfProfile({ profile }: { profile: Record<string, unknown> }) {
  return (
    <div className="grid grid-cols-3 gap-1.5">
      <MetricPill label="演技" value={numericProfileValue(profile, 'actingSkill')} />
      <MetricPill label="推理" value={numericProfileValue(profile, 'reasoningDepth')} />
      <MetricPill label="一致" value={numericProfileValue(profile, 'consistency')} />
    </div>
  )
}

export function ImpressionsPanel({
  matchId,
  gameType,
}: {
  matchId: string
  gameType?: 'poker' | 'werewolf'
}) {
  const [data, setData] = useState<ImpressionResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    api
      .get<ImpressionResponse>(`/api/matches/${matchId}/impressions`)
      .then((result) => {
        if (!cancelled) setData(result)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '印象读取失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [matchId])

  const grouped = useMemo(() => {
    const map = new Map<string, ImpressionRow[]>()
    for (const row of data?.impressions ?? []) {
      const key = `${row.observerAgentId}:${row.observerName}`
      const list = map.get(key) ?? []
      list.push(row)
      map.set(key, list)
    }
    return Array.from(map.entries())
  }, [data])

  if (loading) {
    return (
      <section className="h-full min-h-0 rounded-lg border border-white/10 bg-slate-950/45 p-3 text-sm text-muted-foreground">
        读取印象系统...
      </section>
    )
  }

  if (error) {
    return (
      <section className="h-full min-h-0 rounded-lg border border-rose-300/20 bg-rose-500/10 p-3 text-sm text-rose-100">
        印象读取失败：{error}
      </section>
    )
  }

  if (!data || data.impressions.length === 0) {
    return (
      <section className="h-full min-h-0 rounded-lg border border-white/10 bg-slate-950/45 p-3 text-sm">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200/70">Impressions</div>
        <div className="mt-3 rounded-xl border border-white/10 bg-slate-900/60 p-3 text-xs leading-5 text-muted-foreground">
          暂无长期印象。印象来自 semantic memory，通常在一手牌或一局结束后逐步形成。
        </div>
      </section>
    )
  }

  const resolvedGameType = gameType ?? data.gameType

  return (
    <section className="thin-scrollbar h-full min-h-0 overflow-y-auto rounded-lg border border-white/10 bg-slate-950/45 p-3 text-sm">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200/70">Impressions</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {data.impressionCount} 条 · {data.participantCount} 位选手
          </div>
        </div>
        <Badge variant="outline">semantic</Badge>
      </div>

      <div className="space-y-3">
        {grouped.map(([key, rows]) => {
          const observerName = key.split(':').slice(1).join(':')
          return (
            <div key={key} className="rounded-xl border border-white/10 bg-slate-900/50 p-3">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-100">
                {observerName} 的印象
              </div>
              <ul className="space-y-2">
                {rows.map((row) => (
                  <li key={`${row.observerAgentId}-${row.targetAgentId}`} className="rounded-lg bg-black/20 p-2">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-slate-100">{row.targetName}</span>
                      <Badge variant="secondary">{row.gamesObserved} 局</Badge>
                    </div>
                    {resolvedGameType === 'werewolf' ? (
                      <WerewolfProfile profile={row.profile} />
                    ) : (
                      <PokerProfile profile={row.profile} />
                    )}
                    <div className="mt-2 text-xs leading-5 text-muted-foreground">{profileNote(row.profile)}</div>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>
    </section>
  )
}
