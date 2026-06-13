'use client'

import { useMemo, useState } from 'react'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Maximize2 } from 'lucide-react'
import { useMatchViewStore } from '@/frontend/store/match-view-store'
import { Button } from '@/frontend/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/frontend/components/ui/dialog'

const COLORS = ['#22d3ee', '#a78bfa', '#facc15', '#fb7185', '#34d399', '#60a5fa', '#f472b6', '#a3e635']

function buildTooltipPayload(
  data: Record<string, number>,
  players: Array<{ agentId: string; displayName: string }>,
  startingChips: number,
): string {
  return players
    .map((player) => {
      const chips = data[player.agentId]
      if (typeof chips !== 'number') return null
      const delta = chips - startingChips
      return `${player.displayName}: ${chips}${delta >= 0 ? ' (+' : ' ('}${delta})`
    })
    .filter(Boolean)
    .join('\n')
}

function ChartBody({
  data,
  players,
  startingChips,
  enlarged,
}: {
  data: Array<Record<string, number | string>>
  players: Array<{ agentId: string; displayName: string }>
  startingChips: number
  enlarged?: boolean
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
        <defs>
          {players.map((player, index) => (
            <linearGradient key={player.agentId} id={`fill-${player.agentId}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={COLORS[index % COLORS.length]} stopOpacity={0.22} />
              <stop offset="95%" stopColor={COLORS[index % COLORS.length]} stopOpacity={0.02} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid stroke="rgba(148,163,184,.10)" strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="hand"
          stroke="#64748b"
          fontSize={enlarged ? 12 : 10}
          tickLine={false}
          axisLine={{ stroke: 'rgba(148,163,184,.20)' }}
          label={{ value: '手牌', position: 'insideBottomRight', offset: -4, fill: '#64748b', fontSize: enlarged ? 12 : 10 }}
        />
        <YAxis
          stroke="#64748b"
          fontSize={enlarged ? 12 : 10}
          tickLine={false}
          axisLine={{ stroke: 'rgba(148,163,184,.20)' }}
          tickFormatter={(value) => String(value)}
        />
        <Tooltip
          contentStyle={{
            background: '#020617',
            border: '1px solid rgba(100,116,139,.35)',
            borderRadius: 8,
            fontSize: enlarged ? 13 : 11,
            lineHeight: 1.5,
          }}
          labelStyle={{ color: '#e2e8f0', marginBottom: 4 }}
          itemStyle={{ color: '#cbd5e1' }}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          formatter={(value: any, name: any, props: any) => {
            const payload = props?.payload ?? {}
            const key = String(name ?? '')
            const chips = typeof value === 'number' ? value : Number(payload[key] ?? 0)
            const delta = chips - startingChips
            return [`${chips} (${delta >= 0 ? '+' : ''}${delta})`, key]
          }}
          labelFormatter={(label, payload) => {
            if (!payload?.length) return `第 ${label} 手`
            return `第 ${label} 手\n${buildTooltipPayload(payload[0].payload as Record<string, number>, players, startingChips)}`
          }}
        />
        <ReferenceLine
          y={startingChips}
          stroke="rgba(148,163,184,.35)"
          strokeDasharray="4 4"
          label={{
            value: `起始 ${startingChips}`,
            position: 'insideTopRight',
            fill: '#64748b',
            fontSize: enlarged ? 11 : 9,
          }}
        />
        <Legend
          wrapperStyle={{ fontSize: enlarged ? 12 : 10, paddingTop: 8 }}
          iconType="circle"
        />
        {players.map((player) => (
          <Area
            key={`area-${player.agentId}`}
            type="monotone"
            dataKey={player.agentId}
            name={player.displayName}
            stroke="transparent"
            fill={`url(#fill-${player.agentId})`}
            fillOpacity={1}
            activeDot={false}
            dot={false}
          />
        ))}
        {players.map((player, index) => (
          <Line
            key={player.agentId}
            type="monotone"
            dataKey={player.agentId}
            name={player.displayName}
            stroke={COLORS[index % COLORS.length]}
            strokeWidth={enlarged ? 3 : 2}
            dot={{ r: enlarged ? 4 : 2, strokeWidth: 0, fill: COLORS[index % COLORS.length] }}
            activeDot={{ r: enlarged ? 6 : 4, strokeWidth: 2, stroke: '#020617' }}
          />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  )
}

export function ChipChart({ startingChips = 200 }: { startingChips?: number }) {
  const chipHistory = useMatchViewStore((state) => state.chipHistory)
  const players = useMatchViewStore((state) => state.players)
  const [open, setOpen] = useState(false)

  const data = useMemo(() => {
    const sorted = [...chipHistory].sort((a, b) => a.handNumber - b.handNumber)
    return sorted.map((snapshot) => ({ hand: snapshot.handNumber, ...snapshot.chips }))
  }, [chipHistory])

  if (data.length === 0) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center rounded-lg border border-white/10 bg-slate-950/45 p-4 text-center text-xs text-muted-foreground">
        还没有已完成的手牌
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col rounded-lg border border-white/10 bg-slate-950/45 p-3">
      <div className="mb-2 flex shrink-0 items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">筹码曲线</div>
        <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-slate-100" onClick={() => setOpen(true)} aria-label="放大查看">
          <Maximize2 size={14} />
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        <ChartBody data={data} players={players} startingChips={startingChips} />
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] w-[90vw] max-w-5xl">
          <DialogHeader>
            <DialogTitle>筹码走势</DialogTitle>
          </DialogHeader>
          <div className="h-[60vh] min-h-[320px]">
            <ChartBody data={data} players={players} startingChips={startingChips} enlarged />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
