'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
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

  useEffect(() => {
    if (!open) return
    void api.get<{ providers: ProviderEntry[] }>('/api/providers').then((result) => setProviders(result.providers))
  }, [open])

  useEffect(() => {
    const provider = providers.find((candidate) => candidate.id === providerId)
    if (!provider) return
    setBaseUrl(provider.baseUrl)
    setModel(provider.models[0] ?? '')
  }, [providerId, providers])

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
      router.refresh()
    } catch (err) {
      setError(String(err))
    } finally {
      setSubmitting(false)
    }
  }

  const selectedProvider = providers.find((provider) => provider.id === providerId)

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
          ) : null}
          <div>
            <Label>API Key（只保存到当前浏览器）</Label>
            <Input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="sk-..." />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button onClick={handleSubmit} disabled={submitting || !displayName || !providerId || !model || !baseUrl}>
            {submitting ? '创建中...' : '创建'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
