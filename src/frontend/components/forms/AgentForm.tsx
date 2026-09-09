'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/frontend/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/frontend/components/ui/dialog'
import { Input } from '@/frontend/components/ui/input'
import { Label } from '@/frontend/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/frontend/components/ui/select'
import { Textarea } from '@/frontend/components/ui/textarea'
import { api } from '@/frontend/lib/client/api'
import { presetsFor } from '@/backend/agent/prompt-presets'

type Profile = { id: string; displayName: string; model: string }

/**
 * 简化阿瓦隆（R3-2 冒烟）的玩家人设预设。prompt-presets 属 backend 装配
 * （不为本品类扩面），故以同形结构在 frontend 本地提供。
 */
const AVALON_PLAYER_PRESETS = [
  {
    id: 'balanced-knight',
    label: '圆桌骑士(均衡)',
    description: '通用阿瓦隆玩家 prompt,身份由发牌决定。',
    prompt:
      '你是一位参加 5 人简化阿瓦隆(梅林、派西维尔、忠诚仆从、莫德雷德、爪牙各 1)的玩家。\n\n' +
      '- 身份由发牌私下告知;3 轮任务制,每轮队长提名 2 人队伍、全员表决、成员秘密抉择。\n' +
      '- 好人阵营:通过提名与表决的蛛丝马迹找出坏人,让好队伍上车。\n' +
      '- 坏人阵营:隐藏身份,伺机混入队伍并投失败票,或连续否决好队伍。\n' +
      '- 所有推理用中文,结构清晰(观点 + 证据 + 立场)。',
  },
]

export function AgentForm({
  gameType = 'poker',
  kind = 'player',
}: {
  gameType?: 'poker' | 'werewolf' | 'avalon'
  kind?: 'player' | 'moderator'
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [displayName, setDisplayName] = useState('')
  const [profileId, setProfileId] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [presetId, setPresetId] = useState<string>('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const presets = gameType === 'avalon' ? AVALON_PLAYER_PRESETS : presetsFor(gameType, kind)

  useEffect(() => {
    if (!open) return
    void api.get<{ profiles: Profile[] }>('/api/profiles').then((result) => setProfiles(result.profiles))
    // On open, pre-select the first preset + prefill its prompt so the user
    // doesn't start with an empty textarea.
    if (presets.length > 0 && !systemPrompt && !presetId) {
      setPresetId(presets[0].id)
      setSystemPrompt(presets[0].prompt)
    }
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
      await api.post('/api/agents', { displayName, gameType, kind, profileId, systemPrompt })
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
  const gameLabel = gameType === 'poker' ? '德扑' : gameType === 'avalon' ? '阿瓦隆' : '狼人杀'
  const tagLabel = `${gameLabel}${kind === 'moderator' ? '·主持人' : ''}`

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>新增 {tagLabel} Agent</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>新增 {tagLabel} Agent</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>名称</Label>
            <Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="BluffMaster" />
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
                    {profile.displayName}
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
