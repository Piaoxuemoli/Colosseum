'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/client/api'
import { keyring } from '@/lib/client/keyring'

export function ProfileRowActions({ profileId }: { profileId: string }) {
  const router = useRouter()
  const [hasKey, setHasKey] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setHasKey(keyring.has(profileId))
  }, [profileId])

  async function remove() {
    if (!confirm('确认删除这个 Profile？关联 Agent 需要重新绑定。')) return
    setLoading(true)
    try {
      await api.del(`/api/profiles/${profileId}`)
      keyring.remove(profileId)
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  function resetKey() {
    const nextKey = prompt('输入新的 API Key')
    if (!nextKey?.trim()) return
    keyring.set(profileId, nextKey.trim())
    setHasKey(true)
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant={hasKey ? 'default' : 'outline'}>{hasKey ? 'Key 已配置' : '缺 Key'}</Badge>
      <Button size="sm" variant="outline" onClick={resetKey}>
        修改 Key
      </Button>
      <Button size="sm" variant="destructive" onClick={remove} disabled={loading}>
        删除
      </Button>
    </div>
  )
}
