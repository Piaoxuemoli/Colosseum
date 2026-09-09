'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/frontend/components/ui/badge'
import { Button } from '@/frontend/components/ui/button'
import { Card, CardContent } from '@/frontend/components/ui/card'
import { Input } from '@/frontend/components/ui/input'
import { Label } from '@/frontend/components/ui/label'
import { KeyGatePanel, hasBlockingKey, type KeyGateProfile } from '@/frontend/components/forms/KeyGatePanel'
import { api } from '@/frontend/lib/client/api'
import { keyring, keyringStatus, type KeyStatus } from '@/frontend/lib/client/keyring'
import { toast } from '@/frontend/lib/client/toast'

/**
 * 简化阿瓦隆对局创建（R3-2 冒烟）：固定 5 位玩家 Agent，无 moderator。
 *
 * 复用 WerewolfMatchSetupForm 的模式与 keyring 上传链路（选人 → key 检查 →
 * 提交）；观战侧无专属棋盘，走 generic-v2 兜底渲染（NFR-08 验证点）。
 */

type Agent = {
  id: string
  displayName: string
  avatarEmoji: string | null
  gameType: string
  kind: 'player' | 'moderator'
  profileId: string
}

type Profile = { id: string; displayName: string; model: string }

export function AvalonMatchSetupForm() {
  const router = useRouter()
  const [players, setPlayers] = useState<Agent[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [keyStatuses, setKeyStatuses] = useState<Record<string, KeyStatus>>({})
  const [keysAcknowledged, setKeysAcknowledged] = useState(false)
  const [agentTimeoutMs, setAgentTimeoutMs] = useState(180_000)
  const [minActionIntervalMs, setMinActionIntervalMs] = useState(1_000)
  const [submitting, setSubmitting] = useState(false)
  const [navigating, setNavigating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      const [playerResult, profileResult] = await Promise.all([
        api.get<{ agents: Agent[] }>('/api/agents?gameType=avalon&kind=player'),
        api.get<{ profiles: Profile[] }>('/api/profiles'),
      ])
      setPlayers(playerResult.agents)
      setProfiles(profileResult.profiles)
    })()
  }, [])

  const selectedAgents = useMemo(
    () =>
      selected
        .map((id) => players.find((agent) => agent.id === id))
        .filter((agent): agent is Agent => Boolean(agent)),
    [players, selected],
  )
  const profileIds = useMemo(
    () => Array.from(new Set(selectedAgents.map((agent) => agent.profileId))),
    [selectedAgents],
  )

  useEffect(() => {
    const entries = keyring.entries()
    const meta: Record<string, { apiKey?: string; storedAt?: number }> = {}
    for (const profileId of profileIds) meta[profileId] = entries[profileId] ?? {}
    setKeyStatuses(keyringStatus(meta, Date.now()))
  }, [profileIds])

  const gateProfiles: KeyGateProfile[] = useMemo(
    () =>
      profileIds.map((profileId) => {
        const profile = profiles.find((candidate) => candidate.id === profileId)
        const agentsUsing = selectedAgents.filter((agent) => agent.profileId === profileId)
        return {
          profileId,
          profileName: profile?.displayName ?? profileId,
          model: profile?.model,
          agentNames: agentsUsing.map((agent) => agent.displayName),
          status: keyStatuses[profileId] ?? 'missing',
        }
      }),
    [profileIds, profiles, selectedAgents, keyStatuses],
  )

  const blockingKeys = hasBlockingKey(gateProfiles)
  // 阻断名单一变（改选玩家 / 换 key），此前的「仍要开始」确认作废。
  const blockingSignature = useMemo(
    () =>
      gateProfiles
        .filter((profile) => profile.status === 'missing' || profile.status === 'expired')
        .map((profile) => profile.profileId)
        .sort()
        .join(','),
    [gateProfiles],
  )
  useEffect(() => {
    setKeysAcknowledged(false)
  }, [blockingSignature])

  function toggleSelect(id: string) {
    setSelected((previous) => {
      if (previous.includes(id)) return previous.filter((candidate) => candidate !== id)
      if (previous.length >= 5) return previous
      return [...previous, id]
    })
  }

  function supplyKey(profileId: string) {
    const profile = profiles.find((candidate) => candidate.id === profileId)
    const apiKey = prompt(`为 Profile "${profile?.displayName ?? profileId}" 填入 API Key：`)
    const trimmed = apiKey?.trim()
    if (!trimmed) return
    keyring.set(profileId, trimmed)
    setKeyStatuses((previous) => ({ ...previous, [profileId]: 'ok' }))
    toast.success('密钥已保存', `Profile "${profile?.displayName ?? profileId}" 的密钥已存入本浏览器，开局时自动上传。`)
  }

  async function submit() {
    setSubmitting(true)
    setError(null)
    try {
      // 未走「仍要开始」确认时，兜底防线：逐个补齐缺失 key（与旧行为一致）。
      if (!keysAcknowledged) {
        for (const profileId of profileIds) {
          if (keyring.has(profileId)) continue
          const profile = profiles.find((candidate) => candidate.id === profileId)
          const apiKey = prompt(`为 Profile "${profile?.displayName ?? profileId}" 填入 API Key:`)
          if (!apiKey?.trim()) throw new Error(`缺少 ${profile?.displayName ?? profileId} 的 API Key`)
          keyring.set(profileId, apiKey.trim())
        }
      }

      const keyringPayload: Record<string, string> = {}
      for (const profileId of profileIds) {
        const apiKey = keyring.get(profileId)
        if (apiKey) keyringPayload[profileId] = apiKey
      }

      const result = await api.post<{ matchId: string; streamUrl: string }>('/api/matches', {
        gameType: 'avalon',
        agentIds: selected,
        config: { agentTimeoutMs, minActionIntervalMs },
        keyring: keyringPayload,
      })
      setNavigating(true)
      router.push(`/matches/${result.matchId}`)
    } catch (err) {
      setError(String(err))
    } finally {
      setSubmitting(false)
    }
  }

  const canSubmit =
    selected.length === 5 &&
    !submitting &&
    !navigating &&
    (!blockingKeys || keysAcknowledged)

  return (
    <div className="space-y-8">
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-white">① 选择 5 位玩家</h2>
          <Badge variant={selected.length === 5 ? 'default' : 'outline'}>{selected.length}/5</Badge>
        </div>
        {players.length < 5 ? (
          <p className="mb-3 text-sm text-destructive">
            至少需要 5 个 <code>gameType=avalon, kind=player</code> 的 Agent;当前只有 {players.length} 个。
          </p>
        ) : null}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {players.map((agent) => {
            const isSelected = selected.includes(agent.id)
            const order = isSelected ? selected.indexOf(agent.id) + 1 : 0
            return (
              <Card
                key={agent.id}
                className={`cursor-pointer transition ${
                  isSelected ? 'border-cyan-300/60 bg-cyan-300/10' : 'hover:border-cyan-300/30'
                }`}
                onClick={() => toggleSelect(agent.id)}
              >
                <CardContent className="flex items-center gap-3 p-4">
                  <div className="text-3xl">{agent.avatarEmoji ?? '🛡'}</div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold text-white">{agent.displayName}</div>
                    <div className="font-mono text-xs text-muted-foreground">{agent.id.slice(0, 18)}...</div>
                  </div>
                  {isSelected ? <Badge>#{order}</Badge> : null}
                </CardContent>
              </Card>
            )
          })}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-xl font-semibold text-white">② 对局参数</h2>
        <div className="grid max-w-3xl grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <Label>Agent 超时 ms</Label>
            <Input type="number" value={agentTimeoutMs} onChange={(event) => setAgentTimeoutMs(Number(event.target.value))} />
          </div>
          <div>
            <Label>最小行动间隔 ms</Label>
            <Input
              type="number"
              value={minActionIntervalMs}
              onChange={(event) => setMinActionIntervalMs(Number(event.target.value))}
            />
          </div>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-xl font-semibold text-white">③ Key 检查</h2>
        {profileIds.length === 0 ? (
          <p className="text-sm text-muted-foreground">选择 Agent 后会显示本局需要的 Profile key。</p>
        ) : (
          <KeyGatePanel
            profiles={gateProfiles}
            acknowledged={keysAcknowledged}
            onAcknowledge={() => setKeysAcknowledged(true)}
            onSupplyKey={supplyKey}
          />
        )}
      </section>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Button size="lg" onClick={submit} disabled={!canSubmit}>
        {navigating ? '进入观战...' : submitting ? '创建中...' : '开始对局'}
      </Button>
    </div>
  )
}
