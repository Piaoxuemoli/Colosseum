'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/lib/client/api'
import { presetsFor } from '@/lib/agent/prompt-presets'

type Profile = { id: string; displayName: string; providerId: string; model: string }

const AVATARS = ['🎭', '🎲', '🃏', '♠️', '♥️', '♦️', '♣️', '🤖', '🐺', '🦊']

export function AgentForm({ gameType = 'poker' }: { gameType?: 'poker' | 'werewolf' }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [displayName, setDisplayName] = useState('')
  const [profileId, setProfileId] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [presetId, setPresetId] = useState<string>('')
  const [avatarEmoji, setAvatarEmoji] = useState(AVATARS[2])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const presets = presetsFor(gameType, 'player')

  useEffect(() => {
    if (!open) return
    void api.get<{ profiles: Profile[] }>('/api/profiles').then((result) => setProfiles(result.profiles))
    // On open, pre-select the first preset + prefill its prompt so the user
    // doesn't start with an empty textarea.
    if (presets.length > 0 && !systemPrompt && !presetId) {
      setPresetId(presets[0].id)
      setSystemPrompt(presets[0].prompt)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function applyPreset(nextId: string) {
    setPresetId(nextId)
    const preset = presets.find((p) => p.id === nextId)
    if (preset) setSystemPrompt(preset.prompt)
  }

  async function submit() {
    setSubmitting(true)
    setError(null)
    try {
      await api.post('/api/agents', { displayName, gameType, profileId, systemPrompt, avatarEmoji })
      setOpen(false)
      setDisplayName('')
      setProfileId('')
      setSystemPrompt('')
      setPresetId('')
      router.refresh()
    } catch (err) {
      setError(String(err))
    } finally {
      setSubmitting(false)
    }
  }

  const selectedPreset = presets.find((p) => p.id === presetId)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>新增 Agent</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>新增 {gameType === 'poker' ? '德扑' : '狼人杀'} Agent</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>名称</Label>
            <Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="BluffMaster" />
          </div>
          <div>
            <Label>头像</Label>
            <div className="flex flex-wrap gap-2">
              {AVATARS.map((avatar) => (
                <button
                  key={avatar}
                  type="button"
                  className={`rounded-xl border px-3 py-2 text-2xl transition ${
                    avatarEmoji === avatar ? 'border-primary bg-cyan-300/15' : 'border-transparent hover:border-border'
                  }`}
                  onClick={() => setAvatarEmoji(avatar)}
                >
                  {avatar}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label>API Profile</Label>
            <Select value={profileId} onValueChange={setProfileId}>
              <SelectTrigger>
                <SelectValue placeholder="选择 Profile" />
              </SelectTrigger>
              <SelectContent>
                {profiles.map((profile) => (
                  <SelectItem key={profile.id} value={profile.id}>
                    {profile.displayName} ({profile.model})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {presets.length > 0 ? (
            <div>
              <Label>预设风格</Label>
              <Select value={presetId} onValueChange={applyPreset}>
                <SelectTrigger>
                  <SelectValue placeholder="选一个 preset 或在下方自由编辑" />
                </SelectTrigger>
                <SelectContent>
                  {presets.map((preset) => (
                    <SelectItem key={preset.id} value={preset.id}>
                      {preset.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedPreset ? (
                <p className="mt-1 text-xs text-muted-foreground">{selectedPreset.description}</p>
              ) : null}
            </div>
          ) : null}

          <div>
            <Label>人设 Prompt(可自由编辑)</Label>
            <Textarea
              value={systemPrompt}
              onChange={(event) => setSystemPrompt(event.target.value)}
              rows={8}
              placeholder="先从上方选一个 preset,然后按需要编辑..."
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button onClick={submit} disabled={submitting || !displayName || !profileId || !systemPrompt}>
            {submitting ? '创建中...' : '创建'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
