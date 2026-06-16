'use client'

import { memo } from 'react'
import { motion } from 'framer-motion'
import { LoaderCircle, Skull } from 'lucide-react'
import { ThinkingBubble } from '@/frontend/components/match/ThinkingBubble'
import { useThinkingBubble } from '@/frontend/components/match/use-thinking-bubble'

export type WerewolfDeathCause = 'werewolfKill' | 'witchPoison' | 'vote'

export interface PlayerCardProps {
  agentId: string
  name: string
  alive: boolean
  deathCause?: WerewolfDeathCause | null
  claimedRole?: string
  revealedRole?: string | null
  isCurrentActor: boolean
  /** 当前思考文本（来自 thinking-store.current[agentId]?.text），有值则浮气泡。 */
  thinking?: string
}

const ROLE_COLOR: Record<string, string> = {
  werewolf: 'text-red-400 bg-red-500/15 border-red-500/40',
  seer: 'text-amber-300 bg-amber-500/15 border-amber-500/40',
  witch: 'text-violet-300 bg-violet-500/15 border-violet-500/40',
  villager: 'text-neutral-300 bg-neutral-500/10 border-neutral-500/30',
}

const ROLE_ZH: Record<string, string> = {
  werewolf: '狼人',
  seer: '预言家',
  witch: '女巫',
  villager: '平民',
}

const DEATH_LABEL: Record<string, string> = {
  werewolfKill: '夜刀',
  witchPoison: '毒杀',
  vote: '票出',
}

export const PlayerCard = memo(function PlayerCard(props: PlayerCardProps) {
  const { name, alive, deathCause, claimedRole, revealedRole, isCurrentActor, thinking } = props
  const border = isCurrentActor
    ? 'border-emerald-400 ring-2 ring-emerald-400/40'
    : 'border-neutral-800'
  const pulse = isCurrentActor && alive ? 'animate-pulse' : ''

  const { text: bubbleText, visible: bubbleVisible } = useThinkingBubble(thinking)
  const isThinking = alive && typeof thinking === 'string' && thinking.trim().length > 0

  return (
    <div className="relative">
      {isThinking ? (
        <div className="absolute bottom-full left-1/2 z-30 mb-2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-cyan-200/25 bg-slate-950/90 px-2.5 py-1 text-[10px] font-semibold text-cyan-100 shadow-lg shadow-cyan-950/30 backdrop-blur">
          <LoaderCircle size={12} className="animate-spin text-cyan-200" aria-hidden="true" />
          <span>思考中</span>
        </div>
      ) : null}
      <motion.div
        layout
        animate={{ opacity: alive ? 1 : 0.55, scale: isCurrentActor ? 1.03 : 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 22 }}
        className={`relative rounded-lg border bg-neutral-900 p-3 ${border} ${pulse}`}
        data-testid="werewolf-player-card"
      >
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold text-neutral-100">{name}</div>
            {claimedRole && !revealedRole ? (
              <div className="text-[10px] text-neutral-400">自称 {ROLE_ZH[claimedRole] ?? claimedRole}</div>
            ) : null}
            {revealedRole ? (
              <div
                className={`mt-1 inline-block rounded border px-1.5 py-0.5 text-[10px] ${ROLE_COLOR[revealedRole] ?? ROLE_COLOR.villager}`}
              >
                {ROLE_ZH[revealedRole] ?? revealedRole}
              </div>
            ) : null}
          </div>
        </div>
        {!alive ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 rounded-lg bg-black/60">
            <Skull size={18} className="text-neutral-400" />
            {deathCause ? (
              <span className="text-xs font-semibold text-neutral-300">{DEATH_LABEL[deathCause] ?? deathCause}</span>
            ) : null}
          </div>
        ) : null}
      </motion.div>
      {alive ? (
        <ThinkingBubble text={bubbleText} visible={bubbleVisible} placement="top" />
      ) : null}
    </div>
  )
})
