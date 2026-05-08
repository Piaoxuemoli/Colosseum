'use client'

import { Menu } from 'lucide-react'
import { ActionLog } from './ActionLog'
import { ChipChart } from './ChipChart'
import { ErrorBadge } from './ErrorBadge'
import { LiveScoreboard } from './LiveScoreboard'
import { ThinkingLog } from './ThinkingLog'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

function RightPanelBody({ matchId }: { matchId: string }) {
  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
            Control Rail
          </div>
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
    </>
  )
}

export function RightPanel({ matchId }: { matchId: string }) {
  return (
    <>
      {/* Desktop: always-visible rail. `lg:flex` mirrors SpectatorView's
          `lg:flex-row` so the aside only shows once there's horizontal room. */}
      <aside className="hidden w-full flex-col gap-3 rounded-3xl border border-border bg-slate-950/55 p-3 shadow-2xl shadow-cyan-950/20 lg:flex lg:w-[22rem] lg:min-w-[22rem]">
        <RightPanelBody matchId={matchId} />
      </aside>

      {/* Mobile / tablet: floating "open panel" button + right-side sheet. */}
      <Sheet>
        <SheetTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            aria-label="打开对局信息"
            className="fixed bottom-4 right-4 z-40 rounded-full shadow-lg lg:hidden"
          >
            <Menu size={18} />
          </Button>
        </SheetTrigger>
        <SheetContent side="right" className="flex w-80 max-w-[90vw] flex-col gap-3 overflow-y-auto">
          <SheetHeader>
            <SheetTitle>对局信息</SheetTitle>
          </SheetHeader>
          <RightPanelBody matchId={matchId} />
        </SheetContent>
      </Sheet>
    </>
  )
}
