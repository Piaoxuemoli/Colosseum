'use client'

import { useState } from 'react'
import { MatchSetupForm } from './MatchSetupForm'
import { WerewolfMatchSetupForm } from './WerewolfMatchSetupForm'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

/**
 * Client-side tabs that route the user to either the poker or werewolf
 * match-setup flow. Lives at `/matches/new`.
 */
export function NewMatchTabs({ defaultGame = 'poker' }: { defaultGame?: 'poker' | 'werewolf' }) {
  const [tab, setTab] = useState<'poker' | 'werewolf'>(defaultGame)

  return (
    <Tabs value={tab} onValueChange={(value) => setTab(value as 'poker' | 'werewolf')} className="w-full">
      <TabsList className="mb-6 grid w-full max-w-sm grid-cols-2">
        <TabsTrigger value="poker">德州扑克</TabsTrigger>
        <TabsTrigger value="werewolf">狼人杀</TabsTrigger>
      </TabsList>
      <TabsContent value="poker">
        <div className="mb-6">
          <p className="text-sm text-muted-foreground">选 6 位德扑 Agent,配置盲注和节奏参数,开始观战。</p>
        </div>
        <MatchSetupForm />
      </TabsContent>
      <TabsContent value="werewolf">
        <div className="mb-6">
          <p className="text-sm text-muted-foreground">选 6 位玩家 Agent + 1 位主持人(Moderator),6 人狼人杀 (2 狼 · 1 预言家 · 1 女巫 · 2 村民)。</p>
        </div>
        <WerewolfMatchSetupForm />
      </TabsContent>
    </Tabs>
  )
}
