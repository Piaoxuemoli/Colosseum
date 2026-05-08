'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api } from '@/lib/client/api'
import { keyring } from '@/lib/client/keyring'

type ProviderEntry = {
  id: string
  displayName: string
  baseUrl: string
  models: string[]
}

type TestState =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'ok'; latencyMs: number; sample: string }
  | { kind: 'fail'; error: string }

export function ProfileForm() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [providers, setProviders] = useState<ProviderEntry[]>([])
  const [providerId, setProviderId] = useState('')
  const [model, setModel] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [testState, setTestState] = useState<TestState>({ kind: 'idle' })

  useEffect(() => {
    if (!open) return
    void api.get<{ providers: ProviderEntry[] }>('/api/providers').then((result) => setProviders(result.providers))
  }, [open])

  useEffect(() => {
    const provider = providers.find((candidate) => candidate.id === providerId)
    if (!provider) return
    setBaseUrl(provider.baseUrl)
    setModel(provider.models[0] ?? '')
    // Any form change invalidates the previous test result.
    setTestState({ kind: 'idle' })
  }, [providerId, providers])

  // Invalidate the previous test result whenever the user mutates the
  // underlying probe inputs.
  useEffect(() => {
    setTestState({ kind: 'idle' })
  }, [model, baseUrl, apiKey])

  async function handleTest() {
    setTestState({ kind: 'testing' })
    try {
      const body = await api.post<{ ok: boolean; latencyMs?: number; sample?: string; error?: string }>(
        '/api/profiles/test',
        { providerId, baseUrl, model, apiKey },
      )
      if (body.ok) {
        setTestState({ kind: 'ok', latencyMs: body.latencyMs ?? 0, sample: body.sample ?? '' })
      } else {
        setTestState({ kind: 'fail', error: body.error ?? 'unknown' })
      }
    } catch (err) {
      setTestState({ kind: 'fail', error: err instanceof Error ? err.message : String(err) })
    }
  }

  async function handleSubmit() {
    setSubmitting(true)
    setError(null)
    try {
      const created = await api.post<{ id: string }>('/api/profiles', {
        displayName,
        providerId,
        baseUrl,
        model,
      })
      if (apiKey.trim()) keyring.set(created.id, apiKey.trim())
      setOpen(false)
      setDisplayName('')
      setApiKey('')
      setTestState({ kind: 'idle' })
      router.refresh()
    } catch (err) {
      setError(String(err))
    } finally {
      setSubmitting(false)
    }
  }

  const selectedProvider = providers.find((provider) => provider.id === providerId)
  const canTest = !!providerId && !!baseUrl && !!model && !!apiKey.trim() && testState.kind !== 'testing'

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>新增 Profile</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新增 API Profile</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>名称</Label>
            <Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="DeepSeek Reasoner" />
          </div>
          <div>
            <Label>Provider</Label>
            <Select value={providerId} onValueChange={setProviderId}>
              <SelectTrigger>
                <SelectValue placeholder="选择 provider" />
              </SelectTrigger>
              <SelectContent>
                {providers.map((provider) => (
                  <SelectItem key={provider.id} value={provider.id}>
                    {provider.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {selectedProvider?.id === 'custom' ? (
            <>
              <div>
                <Label>Base URL</Label>
                <Input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://..." />
              </div>
              <div>
                <Label>模型名</Label>
                <Input value={model} onChange={(event) => setModel(event.target.value)} placeholder="gpt-4o" />
              </div>
            </>
          ) : selectedProvider ? (
            <>
              <div>
                <Label>Base URL（可覆盖默认值）</Label>
                <Input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://..." />
              </div>
              <div>
                <Label>模型</Label>
                <Select value={model} onValueChange={setModel}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {selectedProvider.models.map((candidate) => (
                      <SelectItem key={candidate} value={candidate}>
                        {candidate}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          ) : null}
          <div>
            <Label>API Key（只保存到当前浏览器）</Label>
            <Input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="sk-..." />
          </div>

          <TestResult state={testState} />

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={handleTest} disabled={!canTest}>
              {testState.kind === 'testing' ? (
                <>
                  <Loader2 size={14} className="mr-1 animate-spin" />
                  测试中...
                </>
              ) : (
                '测试连接'
              )}
            </Button>
            <Button onClick={handleSubmit} disabled={submitting || !displayName || !providerId || !model || !baseUrl}>
              {submitting ? '创建中...' : '创建'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function TestResult({ state }: { state: TestState }) {
  if (state.kind === 'idle' || state.kind === 'testing') return null
  if (state.kind === 'ok') {
    return (
      <div className="flex items-start gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
        <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="font-semibold">连接成功 · {state.latencyMs}ms</div>
          {state.sample ? (
            <div className="mt-1 truncate font-mono text-xs opacity-80">返回: {state.sample}</div>
          ) : null}
        </div>
      </div>
    )
  }
  return (
    <div className="flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-100">
      <XCircle size={16} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1 break-words">{state.error}</div>
    </div>
  )
}
