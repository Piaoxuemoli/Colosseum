'use client'

import { useMemo } from 'react'
import { useMatchViewStore } from '@/store/match-view-store'

export function VoteTally() {
  const votes = useMatchViewStore((s) => s.werewolf.voteLog)
  const day = useMatchViewStore((s) => s.werewolf.day)

  const tally = useMemo(() => {
    const m = new Map<string, number>()
    for (const v of votes) {
      if (v.day !== day) continue
      if (!v.target) continue
      m.set(v.target, (m.get(v.target) ?? 0) + 1)
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [votes, day])

  const todayVotes = votes.filter((v) => v.day === day)
  if (todayVotes.length === 0) return null

  const max = Math.max(1, ...tally.map(([, n]) => n))

  return (
    <div
      className="rounded-md border border-neutral-800 bg-neutral-900/70 p-2"
      data-testid="werewolf-vote-tally"
    >
      <div className="mb-1 text-xs font-semibold text-neutral-400">
        今日投票 (Day {day})
      </div>
      {tally.length === 0 ? (
        <div className="text-xs text-neutral-500">全员弃票</div>
      ) : (
        <ul className="space-y-1">
          {tally.map(([id, n]) => (
            <li key={id} className="flex items-center gap-2 text-xs">
              <div className="w-16 truncate font-mono">{id}</div>
              <div className="h-2 flex-1 rounded bg-neutral-800">
                <div
                  className="h-full rounded bg-red-500"
                  style={{ width: `${Math.round((n / max) * 100)}%` }}
                />
              </div>
              <div className="w-6 text-right font-mono">{n}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
