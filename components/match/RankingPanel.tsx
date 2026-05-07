'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Trophy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useMatchViewStore } from '@/store/match-view-store'

const MEDALS = ['🥇', '🥈', '🥉']

export function RankingPanel({ initialChips }: { initialChips: number }) {
  const router = useRouter()
  const status = useMatchViewStore((state) => state.status)
  const players = useMatchViewStore((state) => state.players)
  const handNumber = useMatchViewStore((state) => state.handNumber)
  const [dismissed, setDismissed] = useState(false)
  const sorted = [...players].sort((a, b) => b.chips - a.chips)
  const open = status === 'settled' && !dismissed

  useEffect(() => {
    if (status !== 'settled') setDismissed(false)
  }, [status])

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => setDismissed(!nextOpen)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-yellow-300" />
            对局结束
          </DialogTitle>
        </DialogHeader>

        <div className="rounded-2xl border border-cyan-300/15 bg-cyan-300/5 px-4 py-3 text-sm text-muted-foreground">
          共完成 {handNumber} 手，最终筹码排名如下。
        </div>

        <div className="space-y-2">
          {sorted.map((player, index) => {
            const delta = player.chips - initialChips
            return (
              <div key={player.agentId} className="flex items-center gap-3 rounded-2xl border border-border bg-slate-900/55 px-3 py-2">
                <div className="w-9 text-center text-2xl">{MEDALS[index] ?? `#${index + 1}`}</div>
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-cyan-300/15 text-lg">
                  {player.avatarEmoji}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-cyan-50">{player.displayName}</div>
                  <div className="text-xs text-muted-foreground">最终筹码 {player.chips}</div>
                </div>
                <div className={`font-mono text-sm ${delta >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                  {delta >= 0 ? '+' : ''}
                  {delta}
                </div>
              </div>
            )
          })}
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
