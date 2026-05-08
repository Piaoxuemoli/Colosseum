'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/client/api'
import { toast } from '@/lib/client/toast'

type DeleteError = {
  error: string
  kind?: 'running-match' | 'needs-cascade'
  matchIds?: string[]
  hint?: string
}

export function AgentRowActions({ agentId }: { agentId: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function tryDelete(cascade: boolean): Promise<boolean> {
    const path = cascade ? `/api/agents/${agentId}?cascade=true` : `/api/agents/${agentId}`
    const res = await api.raw.del<void>(path)
    if (res.ok) return true

    const body = res.body as DeleteError
    if (res.status === 409 && body.kind === 'needs-cascade') {
      const matchCount = body.matchIds?.length ?? 0
      const proceed = confirm(
        `这个 Agent 被 ${matchCount} 场已结束的对局引用。\n` +
          '确认删除的话,会一并删除对应对局的参与记录(对局本身保留)。\n\n继续?',
      )
      if (!proceed) return false
      return tryDelete(true)
    }
    if (res.status === 409 && body.kind === 'running-match') {
      toast.error('无法删除', '该 Agent 正在一场运行中的对局里,请先结束对局。')
      return false
    }
    toast.error(`请求失败 · ${res.status}`, body.error ?? 'unknown')
    return false
  }

  async function remove() {
    if (!confirm('确认删除这个 Agent？')) return
    setLoading(true)
    try {
      const ok = await tryDelete(false)
      if (ok) router.refresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button size="sm" variant="destructive" onClick={remove} disabled={loading}>
      删除
    </Button>
  )
}
