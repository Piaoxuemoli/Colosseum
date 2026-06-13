'use client'

import { useState } from 'react'
import { Flag, Loader2 } from 'lucide-react'
import { Button } from '@/frontend/components/ui/button'
import { useMatchViewStore } from '@/frontend/store/match-view-store'

export function FinishAfterHandButton({
  matchId,
  status,
}: {
  matchId: string
  status: string
}) {
  const stopRequested = useMatchViewStore((state) => state.stopRequested)
  const matchComplete = useMatchViewStore((state) => state.matchComplete)
  const [pending, setPending] = useState(false)
  const [requested, setRequested] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (status !== 'running') return null

  const isRequested = requested || stopRequested
  const disabled = pending || isRequested || matchComplete
  const label = pending ? '请求中' : isRequested ? '已请求本手后结束' : '本手后结束'
  const Icon = pending ? Loader2 : Flag

  async function requestFinishAfterHand(): Promise<void> {
    setPending(true)
    setError(null)
    try {
      const response = await fetch(`/api/matches/${matchId}/end`, { method: 'POST' })
      if (!response.ok) throw new Error(`request failed: ${response.status}`)
      setRequested(true)
    } catch {
      setError('请求失败')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={requestFinishAfterHand}
      >
        <Icon className={pending ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} aria-hidden="true" />
        {label}
      </Button>
      {error ? <span className="text-xs font-medium text-red-300">{error}</span> : null}
    </div>
  )
}
