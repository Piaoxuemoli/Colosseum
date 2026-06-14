'use client'

import { Activity, BarChart3, Brain, ListChecks, Menu, Sparkles, Trophy } from 'lucide-react'
import { ActionLog } from './ActionLog'
import { ChipChart } from './ChipChart'
import { ErrorBadge } from './ErrorBadge'
import { ImpressionsPanel } from './ImpressionsPanel'
import { LiveScoreboard } from './LiveScoreboard'
import { PokerStatusPanel } from './PokerStatusPanel'
import { ThinkingLog } from './ThinkingLog'
import { Button } from '@/frontend/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/frontend/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/frontend/components/ui/tabs'
import { useMatchViewStore, type RightPanelTab } from '@/frontend/store/match-view-store'

function RightPanelBody({
  matchId,
  gameType,
  startingChips,
}: {
  matchId: string
  gameType?: 'poker' | 'werewolf'
  startingChips?: number
}) {
  const tab = useMatchViewStore((state) => state.rightPanelTab)
  const setTab = useMatchViewStore((state) => state.setRightPanelTab)

  return (
    <>
      <div className="flex shrink-0 items-center justify-between">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
            Control Rail
          </div>
          <div className="mt-1 text-sm font-medium text-slate-100">对局信息</div>
        </div>
        <ErrorBadge matchId={matchId} />
      </div>

      <Tabs value={tab} onValueChange={(value) => setTab(value as RightPanelTab)} className="flex min-h-0 flex-1 flex-col">
        <TabsList className="grid h-auto w-full shrink-0 grid-cols-6 gap-1">
          <TabsTrigger value="status" title="状态" className="px-1.5">
            <Activity size={13} aria-hidden="true" />
            <span>状态</span>
          </TabsTrigger>
          <TabsTrigger value="rank" title="排名" className="px-1.5">
            <Trophy size={13} aria-hidden="true" />
            <span>排名</span>
          </TabsTrigger>
          <TabsTrigger value="actions" title="行动" className="px-1.5">
            <ListChecks size={13} aria-hidden="true" />
            <span>行动</span>
          </TabsTrigger>
          <TabsTrigger value="thinking" title="思考" className="px-1.5">
            <Brain size={13} aria-hidden="true" />
            <span>思考</span>
          </TabsTrigger>
          <TabsTrigger value="impressions" title="印象" className="px-1.5">
            <Sparkles size={13} aria-hidden="true" />
            <span>印象</span>
          </TabsTrigger>
          <TabsTrigger value="chart" title="走势" className="px-1.5">
            <BarChart3 size={13} aria-hidden="true" />
            <span>走势</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="status" className="mt-2 min-h-0 flex-1 overflow-hidden">
          {tab === 'status' ? (
            gameType === 'poker' ? (
              <PokerStatusPanel />
            ) : (
              <div className="h-full min-h-0 rounded-lg border border-white/10 bg-slate-950/45 p-3 text-sm text-muted-foreground">
                狼人杀状态面板
              </div>
            )
          ) : null}
        </TabsContent>

        <TabsContent value="rank" className="mt-2 min-h-0 flex-1 overflow-hidden">
          {tab === 'rank' ? <LiveScoreboard /> : null}
        </TabsContent>

        <TabsContent value="actions" className="mt-2 min-h-0 flex-1 overflow-hidden">
          {tab === 'actions' ? <ActionLog /> : null}
        </TabsContent>

        <TabsContent value="thinking" className="mt-2 min-h-0 flex-1 overflow-hidden">
          {tab === 'thinking' ? <ThinkingLog /> : null}
        </TabsContent>

        <TabsContent value="impressions" className="mt-2 min-h-0 flex-1 overflow-hidden">
          {tab === 'impressions' ? <ImpressionsPanel matchId={matchId} gameType={gameType} /> : null}
        </TabsContent>

        <TabsContent value="chart" className="mt-2 min-h-0 flex-1 overflow-hidden">
          {tab === 'chart' ? <ChipChart startingChips={startingChips} /> : null}
        </TabsContent>
      </Tabs>
    </>
  )
}

export function RightPanel({
  matchId,
  gameType,
  startingChips,
}: {
  matchId: string
  gameType?: 'poker' | 'werewolf'
  startingChips?: number
}) {
  return (
    <>
      {/* Desktop: fixed-height rail without outer scrollbar. */}
      <aside className="hidden h-full max-h-full min-h-0 w-full flex-col gap-3 rounded-lg border border-white/10 bg-slate-950/60 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] lg:flex lg:w-[22rem] lg:min-w-[22rem]">
        <RightPanelBody matchId={matchId} gameType={gameType} startingChips={startingChips} />
      </aside>

      {/* Mobile / tablet: floating "open panel" button + right-side sheet. */}
      <Sheet>
        <SheetTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            aria-label="打开对局信息"
            className="fixed bottom-4 right-4 z-40 rounded-full lg:hidden"
          >
            <Menu size={18} />
          </Button>
        </SheetTrigger>
        <SheetContent side="right" className="flex h-[100dvh] w-80 max-w-[90vw] flex-col gap-3 overflow-hidden">
          <SheetHeader>
            <SheetTitle>对局信息</SheetTitle>
          </SheetHeader>
          <RightPanelBody matchId={matchId} gameType={gameType} startingChips={startingChips} />
        </SheetContent>
      </Sheet>
    </>
  )
}
