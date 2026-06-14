'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Trash2, Siren } from 'lucide-react'
import { Button } from '@/frontend/components/ui/button'

export function MatchCardActions({ matchId, status }: { matchId: string; status: string }) {
  const router = useRouter()
  const [forceEnding, setForceEnding] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const isRunning = status === 'running'

  async function handleForceEnd(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (!window.confirm('确定要强制结束这场对局吗？当前手牌会立即终止。')) return
    setForceEnding(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/matches/${matchId}/force-end`, { method: 'POST' })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error ?? `请求失败 ${res.status}`)
      }
      setMessage('已强制结束')
      router.refresh()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '强制结束失败')
    } finally {
      setForceEnding(false)
    }
  }

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (!window.confirm('确定要删除这场对局吗？所有事件、错误和记忆记录都会被清理。')) return
    setDeleting(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/matches/${matchId}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error ?? `请求失败 ${res.status}`)
      }
      router.refresh()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '删除失败')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
      {isRunning ? (
        <Button
          type="button"
          variant="destructive"
          size="sm"
          className="h-7 gap-1 text-xs"
          disabled={forceEnding}
          onClick={handleForceEnd}
        >
          {forceEnding ? <Loader2 className="h-3 w-3 animate-spin" /> : <Siren className="h-3 w-3" />}
          强制结束
        </Button>
      ) : null}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 gap-1 text-xs"
        disabled={deleting}
        onClick={handleDelete}
      >
        {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
        删除
      </Button>
      {message ? <span className="text-xs text-red-300">{message}</span> : null}
    </div>
  )
}
