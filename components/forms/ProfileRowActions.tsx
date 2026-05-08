'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/client/api'
import { keyring } from '@/lib/client/keyring'

type TestState =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'ok'; latencyMs: number }
  | { kind: 'fail'; error: string }

export function ProfileRowActions({
  profileId,
  providerId,
  baseUrl,
  model,
}: {
  profileId: string
  providerId: string
  baseUrl: string
  model: string
}) {
  const router = useRouter()
  const [hasKey, setHasKey] = useState(false)
  const [loading, setLoading] = useState(false)
  const [testState, setTestState] = useState<TestState>({ kind: 'idle' })

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
    setTestState({ kind: 'idle' })
  }

  async function test() {
    const apiKey = keyring.get(profileId)
    if (!apiKey) {
      setTestState({ kind: 'fail', error: '当前浏览器没存这个 Profile 的 API Key,先点"修改 Key"填入' })
      return
    }
    setTestState({ kind: 'testing' })
    try {
      const body = await api.post<{ ok: boolean; latencyMs?: number; error?: string }>(
        '/api/profiles/test',
        { providerId, baseUrl, model, apiKey },
      )
      if (body.ok) {
        setTestState({ kind: 'ok', latencyMs: body.latencyMs ?? 0 })
      } else {
        setTestState({ kind: 'fail', error: body.error ?? 'unknown' })
      }
    } catch (err) {
      setTestState({ kind: 'fail', error: err instanceof Error ? err.message : String(err) })
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={hasKey ? 'default' : 'outline'}>{hasKey ? 'Key 已配置' : '缺 Key'}</Badge>
        <Button size="sm" variant="outline" onClick={test} disabled={testState.kind === 'testing' || !hasKey}>
          {testState.kind === 'testing' ? (
            <>
              <Loader2 size={12} className="mr-1 animate-spin" />
              测试中
            </>
          ) : (
            '测试连接'
          )}
        </Button>
        <Button size="sm" variant="outline" onClick={resetKey}>
          修改 Key
        </Button>
        <Button size="sm" variant="destructive" onClick={remove} disabled={loading}>
          删除
        </Button>
      </div>
      {testState.kind === 'ok' ? (
        <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-100">
          ✓ {testState.latencyMs}ms
        </Badge>
      ) : null}
      {testState.kind === 'fail' ? (
        <span className="max-w-xs truncate text-right text-xs text-red-300" title={testState.error}>
          ✗ {testState.error}
        </span>
      ) : null}
    </div>
  )
}
