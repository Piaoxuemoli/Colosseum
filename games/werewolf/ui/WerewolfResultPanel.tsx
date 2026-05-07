'use client'

import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useMatchViewStore } from '@/store/match-view-store'
import type { PokerUiPlayer } from '@/store/match-view-store'

const ZH: Record<string, string> = {
  werewolf: '狼人',
  seer: '预言家',
  witch: '女巫',
  villager: '平民',
}

const TITLE: Record<string, string> = {
  werewolves: '🐺 狼人阵营胜利',
  villagers: '🏠 好人阵营胜利',
  tie: '⚖️ 平局（达到 40 天上限）',
}

export function WerewolfResultPanel({ players }: { players: PokerUiPlayer[] }) {
  const status = useMatchViewStore((s) => s.status)
  const winner = useMatchViewStore((s) => s.werewolf.winner)
  const roleAssignments = useMatchViewStore((s) => s.werewolf.roleAssignments)
  const day = useMatchViewStore((s) => s.werewolf.day)
  const speechCount = useMatchViewStore((s) => s.werewolf.speechLog.length)
  const router = useRouter()
  const open = status === 'settled' && winner !== null
  const title = winner ? TITLE[winner] : ''

  const ordered = [...players].sort((a, b) => a.seatIndex - b.seatIndex)

  return (
    <Dialog open={open}>
      <DialogContent
        className="max-w-lg"
        data-testid="werewolf-result-panel"
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-2">
          <div className="text-xs font-semibold text-neutral-400">身份揭露</div>
          {ordered.map((p) => (
            <div
              key={p.agentId}
              className="flex items-center gap-3 rounded border border-neutral-800 px-3 py-2"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-700 text-xs font-bold text-white">
                {p.displayName.slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1 truncate">{p.displayName}</div>
              <div className="text-sm text-neutral-200">
                {ZH[roleAssignments?.[p.agentId] ?? ''] ?? '?'}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-2 text-xs text-neutral-500">
          持续 {day} 天 · 共发言 {speechCount} 次
        </div>

        <div className="flex justify-end">
          <Button variant="outline" onClick={() => router.push('/')}>
            返回大厅
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
