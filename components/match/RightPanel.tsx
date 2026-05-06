'use client'

import { ActionLog } from './ActionLog'
import { ChipChart } from './ChipChart'
import { ErrorBadge } from './ErrorBadge'
import { LiveScoreboard } from './LiveScoreboard'
import { ThinkingLog } from './ThinkingLog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export function RightPanel({ matchId }: { matchId: string }) {
  return (
    <aside className="flex w-full flex-col gap-3 rounded-3xl border border-border bg-slate-950/55 p-3 shadow-2xl shadow-cyan-950/20 lg:w-[22rem] lg:min-w-[22rem]">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">Control Rail</div>
          <div className="mt-1 text-sm font-semibold text-cyan-50">对局信息</div>
        </div>
        <ErrorBadge matchId={matchId} />
      </div>

      <LiveScoreboard />

      <Tabs defaultValue="actions" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="actions">行动</TabsTrigger>
          <TabsTrigger value="thinking">思考</TabsTrigger>
        </TabsList>
        <TabsContent value="actions" className="mt-2">
          <ActionLog />
        </TabsContent>
        <TabsContent value="thinking" className="mt-2">
          <ThinkingLog />
        </TabsContent>
      </Tabs>

      <ChipChart />
    </aside>
  )
}
