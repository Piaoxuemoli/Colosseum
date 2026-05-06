'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/client/api'
import { keyring } from '@/lib/client/keyring'

type Agent = {
  id: string
  displayName: string
  avatarEmoji: string | null
  gameType: 'poker' | 'werewolf'
  profileId: string
}

type Profile = { id: string; displayName: string; model: string }

export function MatchSetupForm() {
  const router = useRouter()
  const [agents, setAgents] = useState<Agent[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [keyStatus, setKeyStatus] = useState<Record<string, boolean>>({})
  const [smallBlind, setSmallBlind] = useState(2)
  const [bigBlind, setBigBlind] = useState(4)
  const [startingChips, setStartingChips] = useState(200)
  const [agentTimeoutMs, setAgentTimeoutMs] = useState(60_000)
  const [minActionIntervalMs, setMinActionIntervalMs] = useState(1_000)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      const [agentResult, profileResult] = await Promise.all([
        api.get<{ agents: Agent[] }>('/api/agents?gameType=poker'),
        api.get<{ profiles: Profile[] }>('/api/profiles'),
      ])
      setAgents(agentResult.agents.filter((agent) => agent.gameType === 'poker'))
      setProfiles(profileResult.profiles)
    })()
  }, [])

  const selectedAgents = useMemo(
    () => selected.map((id) => agents.find((agent) => agent.id === id)).filter((agent): agent is Agent => Boolean(agent)),
    [agents, selected],
  )
  const profileIds = useMemo(
    () => Array.from(new Set(selectedAgents.map((agent) => agent.profileId))),
    [selectedAgents],
  )

  useEffect(() => {
    const next: Record<string, boolean> = {}
    for (const profileId of profileIds) next[profileId] = keyring.has(profileId)
    setKeyStatus(next)
  }, [profileIds])

  function toggleSelect(id: string) {
    setSelected((previous) => {
      if (previous.includes(id)) return previous.filter((candidate) => candidate !== id)
      if (previous.length >= 6) return previous
      return [...previous, id]
    })
  }

  async function submit() {
    setSubmitting(true)
    setError(null)
    try {
      for (const profileId of profileIds) {
        if (keyring.has(profileId)) continue
        const profile = profiles.find((candidate) => candidate.id === profileId)
        const apiKey = prompt(`为 Profile "${profile?.displayName ?? profileId}" 填入 API Key：`)
        if (!apiKey?.trim()) throw new Error(`缺少 ${profile?.displayName ?? profileId} 的 API Key`)
        keyring.set(profileId, apiKey.trim())
      }

      const keyringPayload: Record<string, string> = {}
      for (const profileId of profileIds) {
        const apiKey = keyring.get(profileId)
        if (apiKey) keyringPayload[profileId] = apiKey
      }

      const result = await api.post<{ matchId: string; streamUrl: string }>('/api/matches', {
        gameType: 'poker',
        agentIds: selected,
        engineConfig: { smallBlind, bigBlind, startingChips, maxBetsPerStreet: 4 },
        config: { agentTimeoutMs, minActionIntervalMs },
        keyring: keyringPayload,
      })
      router.push(`/matches/${result.matchId}`)
    } catch (err) {
      setError(String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-8">
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-white">① 选择 6 位选手</h2>
          <Badge variant={selected.length === 6 ? 'default' : 'outline'}>{selected.length}/6</Badge>
        </div>
        {agents.length < 6 ? (
          <p className="mb-3 text-sm text-destructive">至少需要 6 个德扑 Agent；当前只有 {agents.length} 个。</p>
        ) : null}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {agents.map((agent) => {
            const isSelected = selected.includes(agent.id)
            const order = isSelected ? selected.indexOf(agent.id) + 1 : 0
            return (
              <Card
                key={agent.id}
                className={`cursor-pointer transition ${isSelected ? 'border-cyan-300/60 bg-cyan-300/10' : 'hover:border-cyan-300/30'}`}
                onClick={() => toggleSelect(agent.id)}
              >
                <CardContent className="flex items-center gap-3 p-4">
                  <div className="text-3xl">{agent.avatarEmoji ?? '🃏'}</div>
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
        <div className="grid max-w-3xl grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <Label>小盲</Label>
            <Input type="number" value={smallBlind} onChange={(event) => setSmallBlind(Number(event.target.value))} />
          </div>
          <div>
            <Label>大盲</Label>
            <Input type="number" value={bigBlind} onChange={(event) => setBigBlind(Number(event.target.value))} />
          </div>
          <div>
            <Label>初始筹码</Label>
            <Input type="number" value={startingChips} onChange={(event) => setStartingChips(Number(event.target.value))} />
          </div>
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
          <div className="space-y-2">
            {profileIds.map((profileId) => {
              const profile = profiles.find((candidate) => candidate.id === profileId)
              const hasKey = keyStatus[profileId] ?? false
              return (
                <div key={profileId} className="flex items-center gap-2 text-sm">
                  <Badge variant={hasKey ? 'default' : 'destructive'}>{hasKey ? 'OK' : '缺 key'}</Badge>
                  <span>{profile?.displayName ?? profileId}</span>
                  <span className="text-muted-foreground">{profile?.model}</span>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Button size="lg" onClick={submit} disabled={submitting || selected.length !== 6}>
        {submitting ? '创建中...' : '开始对局'}
      </Button>
    </div>
  )
}
