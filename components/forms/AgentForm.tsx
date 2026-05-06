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

type Profile = { id: string; displayName: string; providerId: string; model: string }

const AVATARS = ['🎭', '🎲', '🃏', '♠️', '♥️', '♦️', '♣️', '🤖', '🐺', '🦊']

export function AgentForm({ gameType = 'poker' }: { gameType?: 'poker' | 'werewolf' }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [displayName, setDisplayName] = useState('')
  const [profileId, setProfileId] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [avatarEmoji, setAvatarEmoji] = useState(AVATARS[2])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    void api.get<{ profiles: Profile[] }>('/api/profiles').then((result) => setProfiles(result.profiles))
  }, [open])

  async function submit() {
    setSubmitting(true)
    setError(null)
    try {
      await api.post('/api/agents', { displayName, gameType, profileId, systemPrompt, avatarEmoji })
      setOpen(false)
      setDisplayName('')
      setProfileId('')
      setSystemPrompt('')
      router.refresh()
    } catch (err) {
      setError(String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>新增 Agent</Button>
      </DialogTrigger>
      <DialogContent>
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
          <div>
            <Label>人设 Prompt</Label>
            <Textarea
              value={systemPrompt}
              onChange={(event) => setSystemPrompt(event.target.value)}
              rows={5}
              placeholder="你是一个经验丰富的德州扑克玩家，擅长观察对手下注模式..."
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
