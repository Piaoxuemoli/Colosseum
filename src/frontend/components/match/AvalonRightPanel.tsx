'use client'

import { Activity, Brain, ListChecks, Menu, Trophy } from 'lucide-react'
import { AvalonActionLog } from './AvalonActionLog'
import { AvalonRosterPanel, AvalonStatusPanel } from './AvalonStatusPanel'
import { ErrorBadge } from './ErrorBadge'
import { ThinkingAgentFilter } from './ThinkingAgentFilter'
import { ThinkingLog } from './ThinkingLog'
import { Button } from '@/frontend/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/frontend/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/frontend/components/ui/tabs'
import { useMatchViewStore, type RightPanelTab } from '@/frontend/store/match-view-store'

/**
 * 阿瓦隆右栏（avalon-frontend PRD §3）：平台统一右栏框架的阿瓦隆形态——
 * 状态 / 名册 / 发言流（默认，阿瓦隆专属 tab）/ 思考；思考链与异常可见性
 * 直接继承平台组件（FR-4.4-02/04），无 impresssions/chart（无筹码面）。
 * tab 状态复用 store.rightPanelTab（'actions' 槽位承载发言流）。
 */
function AvalonRightPanelBody({ matchId }: { matchId: string }) {
  const tab = useMatchViewStore((state) => state.rightPanelTab)
  const setTab = useMatchViewStore((state) => state.setRightPanelTab)

  return (
    <>
      <div className="flex shrink-0 items-center justify-between">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">Control Rail</div>
          <div className="mt-1 text-sm font-medium text-slate-100">对局信息</div>
        </div>
        <ErrorBadge matchId={matchId} />
      </div>

      <Tabs value={tab} onValueChange={(value) => setTab(value as RightPanelTab)} className="flex min-h-0 flex-1 flex-col">
        <TabsList className="grid h-auto w-full shrink-0 grid-cols-4 gap-1">
          <TabsTrigger value="status" title="状态" className="px-1.5">
            <Activity size={13} aria-hidden="true" />
            <span>状态</span>
          </TabsTrigger>
          <TabsTrigger value="rank" title="名册" className="px-1.5">
            <Trophy size={13} aria-hidden="true" />
            <span>名册</span>
          </TabsTrigger>
          <TabsTrigger value="actions" title="发言流" className="px-1.5">
            <ListChecks size={13} aria-hidden="true" />
            <span>发言流</span>
          </TabsTrigger>
          <TabsTrigger value="thinking" title="思考" className="px-1.5">
            <Brain size={13} aria-hidden="true" />
            <span>思考</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="status" className="mt-2 min-h-0 flex-1 overflow-hidden">
          {tab === 'status' ? <AvalonStatusPanel /> : null}
        </TabsContent>
        <TabsContent value="rank" className="mt-2 min-h-0 flex-1 overflow-hidden">
          {tab === 'rank' ? <AvalonRosterPanel /> : null}
        </TabsContent>
        <TabsContent value="actions" className="mt-2 min-h-0 flex-1 overflow-hidden">
          {tab === 'actions' ? <AvalonActionLog /> : null}
        </TabsContent>
        <TabsContent value="thinking" className="mt-2 min-h-0 flex-1 overflow-hidden">
          {tab === 'thinking' ? (
            <div className="flex h-full min-h-0 flex-col gap-2">
              <ThinkingAgentFilter />
              <div className="min-h-0 flex-1">
                <ThinkingLog />
              </div>
            </div>
          ) : null}
        </TabsContent>
      </Tabs>
    </>
  )
}

export function AvalonRightPanel({ matchId }: { matchId: string }) {
  return (
    <>
      {/* Desktop: fixed-height rail without outer scrollbar. */}
      <aside className="hidden h-full max-h-full min-h-0 w-full flex-col gap-3 rounded-lg border border-white/10 bg-slate-950/60 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] lg:flex lg:w-[22rem] lg:min-w-[22rem]">
        <AvalonRightPanelBody matchId={matchId} />
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
          <AvalonRightPanelBody matchId={matchId} />
        </SheetContent>
      </Sheet>
    </>
  )
}
