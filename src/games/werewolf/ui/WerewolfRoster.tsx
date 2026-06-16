'use client'

import { Skull } from 'lucide-react'
import { useMatchViewStore } from '@/frontend/store/match-view-store'
import type { WerewolfDeathCause } from './PlayerCard'

const ROLE_ZH: Record<string, string> = {
  werewolf: '狼人',
  seer: '预言家',
  witch: '女巫',
  villager: '平民',
}

const ROLE_COLOR: Record<string, string> = {
  werewolf: 'text-red-300 bg-red-500/15 border-red-500/40',
  seer: 'text-amber-300 bg-amber-500/15 border-amber-500/40',
  witch: 'text-violet-300 bg-violet-500/15 border-violet-500/40',
  villager: 'text-neutral-300 bg-neutral-500/10 border-neutral-500/30',
}

const DEATH_LABEL: Record<string, string> = {
  werewolfKill: '夜刀',
  witchPoison: '毒杀',
  vote: '票出',
}

/** 狼人杀右侧「名册」tab（替代扑克的筹码排行榜）：存活花名册 + 自称/已揭身份。 */
export function WerewolfRoster() {
  const players = useMatchViewStore((s) => s.players)
  const ww = useMatchViewStore((s) => s.werewolf)

  const deathCause = new Map<string, WerewolfDeathCause | null>()
  for (const d of ww.deaths) deathCause.set(d.agentId, (d.cause as WerewolfDeathCause | null) ?? null)

  const claimedByAgent = new Map<string, string>()
  for (const sp of ww.speechLog) if (sp.claimedRole) claimedByAgent.set(sp.agentId, sp.claimedRole)

  const ordered = [...players].sort((a, b) => a.seatIndex - b.seatIndex)

  return (
    <div className="h-full min-h-0 space-y-1.5 overflow-y-auto thin-scrollbar" data-testid="werewolf-roster">
      {ordered.length === 0 ? (
        <div className="flex h-full min-h-[120px] items-center justify-center text-sm text-muted-foreground">
          暂无玩家
        </div>
      ) : null}
      {ordered.map((p) => {
        const dead = deathCause.has(p.agentId)
        const revealed = ww.roleAssignments?.[p.agentId] ?? null
        const claimed = claimedByAgent.get(p.agentId)
        return (
          <div
            key={p.agentId}
            className={`flex items-center gap-2 rounded-lg border bg-slate-950/45 p-2 ${
              dead ? 'border-white/5 opacity-60' : 'border-white/10'
            }`}
          >
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-700/80 text-[11px] font-bold text-white">
              {p.seatIndex + 1}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm font-medium text-slate-100">{p.displayName}</span>
                {dead ? (
                  <span className="inline-flex items-center gap-0.5 text-[10px] text-neutral-400">
                    <Skull size={10} aria-hidden="true" />
                    {deathCause.get(p.agentId) ? DEATH_LABEL[deathCause.get(p.agentId) as string] ?? '' : ''}
                  </span>
                ) : (
                  <span className="text-[10px] text-emerald-400/80">存活</span>
                )}
              </div>
              <div className="mt-0.5 text-[10px] text-muted-foreground">
                {revealed ? (
                  <span className={`inline-block rounded border px-1 ${ROLE_COLOR[revealed] ?? ROLE_COLOR.villager}`}>
                    {ROLE_ZH[revealed] ?? revealed}
                  </span>
                ) : claimed ? (
                  <span className="text-amber-300/80">自称 {ROLE_ZH[claimed] ?? claimed}</span>
                ) : (
                  <span className="text-neutral-500">身份未明</span>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
