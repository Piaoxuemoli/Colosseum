'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { MatchSetupForm } from './MatchSetupForm'
import { WerewolfMatchSetupForm } from './WerewolfMatchSetupForm'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/frontend/components/ui/tabs'
import { A2UIConfigSurface } from '@/frontend/components/a2ui/A2UIConfigSurface'
import { getGameA2UIConfig } from '@/frontend/components/a2ui/game-configs'
import { isA2UIConfigEnabled } from '@/frontend/lib/client/a2ui-flag'
import { api } from '@/frontend/lib/client/api'

/**
 * 德扑配置页：kill-switch 开启且该游戏已接入 A2UI 时，渲染声明式 A2UI 配置页；
 * 否则回退旧硬编码表单（零风险默认）。详见 spec D8 / T7。
 */
function PokerSetup() {
  const router = useRouter()
  const cfg = isA2UIConfigEnabled() ? getGameA2UIConfig('poker') : undefined

  if (!cfg) {
    return <MatchSetupForm />
  }

  return (
    <A2UIConfigSurface
      configSurface={cfg.configSurface}
      configDefaults={cfg.configDefaults}
      configHandle={cfg.configHandle}
      onSubmit={async (payload) => {
        // payload 由 configHandle.submit 转换好（含 gameType/agentIds/engineConfig/config）。
        // 注意：stub 阶段不含 keyring（AgentPicker 尚未接入完整选人/key 流程），
        // 故该路径仅作声明式渲染闭环验证；默认 kill-switch 关闭时仍走旧表单。
        const result = await api.post<{ matchId: string }>('/api/matches', payload)
        router.push(`/matches/${result.matchId}`)
      }}
    />
  )
}

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
        <PokerSetup />
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
