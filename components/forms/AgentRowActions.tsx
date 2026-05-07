'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/client/api'

export function AgentRowActions({ agentId }: { agentId: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function remove() {
    if (!confirm('确认删除这个 Agent？')) return
    setLoading(true)
    try {
      await api.del(`/api/agents/${agentId}`)
      router.refresh()
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
