'use client'

import type { ReactNode } from 'react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export function AgentsTabs({
  pokerCount,
  werewolfPlayerCount,
  werewolfModeratorCount,
  pokerAgents,
  werewolfPlayerAgents,
  werewolfModeratorAgents,
  newPokerForm,
  newWerewolfPlayerForm,
  newWerewolfModeratorForm,
}: {
  pokerCount: number
  werewolfPlayerCount: number
  werewolfModeratorCount: number
  pokerAgents: ReactNode
  werewolfPlayerAgents: ReactNode
  werewolfModeratorAgents: ReactNode
  newPokerForm: ReactNode
  newWerewolfPlayerForm: ReactNode
  newWerewolfModeratorForm: ReactNode
}) {
  const [tab, setTab] = useState<'poker' | 'werewolf-player' | 'werewolf-moderator'>('poker')

  return (
    <Tabs value={tab} onValueChange={(value) => setTab(value as typeof tab)} className="w-full">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <TabsList className="grid w-full max-w-xl grid-cols-3">
          <TabsTrigger value="poker">
            德扑 <Badge variant="outline" className="ml-2">{pokerCount}</Badge>
          </TabsTrigger>
          <TabsTrigger value="werewolf-player">
            狼人杀·玩家 <Badge variant="outline" className="ml-2">{werewolfPlayerCount}</Badge>
          </TabsTrigger>
          <TabsTrigger value="werewolf-moderator">
            狼人杀·主持人 <Badge variant="outline" className="ml-2">{werewolfModeratorCount}</Badge>
          </TabsTrigger>
        </TabsList>
        <div>
          {tab === 'poker' ? newPokerForm : null}
          {tab === 'werewolf-player' ? newWerewolfPlayerForm : null}
          {tab === 'werewolf-moderator' ? newWerewolfModeratorForm : null}
        </div>
      </div>

      <TabsContent value="poker">{pokerAgents}</TabsContent>
      <TabsContent value="werewolf-player">{werewolfPlayerAgents}</TabsContent>
      <TabsContent value="werewolf-moderator">{werewolfModeratorAgents}</TabsContent>
    </Tabs>
  )
}
