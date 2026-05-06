'use client'

import { useMemo } from 'react'
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useMatchViewStore } from '@/store/match-view-store'

const COLORS = ['#22d3ee', '#a78bfa', '#facc15', '#fb7185', '#34d399', '#60a5fa']

export function ChipChart() {
  const chipHistory = useMatchViewStore((state) => state.chipHistory)
  const players = useMatchViewStore((state) => state.players)
  const data = useMemo(
    () => chipHistory.map((snapshot) => ({ hand: snapshot.handNumber, ...snapshot.chips })),
    [chipHistory],
  )

  if (data.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-slate-950/45 p-4 text-center text-xs text-muted-foreground">
        还没有已完成的手牌
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-border bg-slate-950/45 p-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">筹码曲线</div>
      <ResponsiveContainer width="100%" height={190}>
        <LineChart data={data}>
          <CartesianGrid stroke="rgba(148,163,184,.16)" strokeDasharray="3 3" />
          <XAxis dataKey="hand" stroke="#94a3b8" fontSize={10} />
          <YAxis stroke="#94a3b8" fontSize={10} />
          <Tooltip contentStyle={{ background: '#020617', border: '1px solid rgba(148,163,184,.24)', fontSize: 12 }} />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          {players.map((player, index) => (
            <Line
              key={player.agentId}
              type="monotone"
              dataKey={player.agentId}
              name={player.displayName}
              stroke={COLORS[index % COLORS.length]}
              strokeWidth={2}
              dot={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
