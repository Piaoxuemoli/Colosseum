'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/client/api'
import { keyring, uploadKeysForMatch } from '@/lib/client/keyring'

/**
 * Werewolf match setup: 6 player agents + 1 moderator agent.
 *
 * Shares the structure of the poker form (pick agents, key check, submit)
 * but enforces werewolf-specific constraints:
 *   - exactly 6 players (no duplicates)
 *   - moderator is a separate agent (kind=moderator) and can't also play
 */

type Agent = {
  id: string
  displayName: string
  avatarEmoji: string | null
  gameType: 'poker' | 'werewolf'
  kind: 'player' | 'moderator'
  profileId: string
}

type Profile = { id: string; displayName: string; model: string }

export function WerewolfMatchSetupForm() {
  const router = useRouter()
  const [players, setPlayers] = useState<Agent[]>([])
  const [moderators, setModerators] = useState<Agent[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [moderatorId, setModeratorId] = useState<string>('')
  const [keyStatus, setKeyStatus] = useState<Record<string, boolean>>({})
  const [agentTimeoutMs, setAgentTimeoutMs] = useState(180_000)
  const [minActionIntervalMs, setMinActionIntervalMs] = useState(1_000)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      const [playerResult, moderatorResult, profileResult] = await Promise.all([
        api.get<{ agents: Agent[] }>('/api/agents?gameType=werewolf&kind=player'),
        api.get<{ agents: Agent[] }>('/api/agents?gameType=werewolf&kind=moderator'),
        api.get<{ profiles: Profile[] }>('/api/profiles'),
      ])
      setPlayers(playerResult.agents)
      setModerators(moderatorResult.agents)
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
  // Both players and moderator contribute to the key upload payload.
  const profileIds = useMemo(() => {
    const ids = new Set<string>()
    for (const agent of selectedAgents) ids.add(agent.profileId)
    const mod = moderators.find((m) => m.id === moderatorId)
    if (mod) ids.add(mod.profileId)
    return Array.from(ids)
  }, [selectedAgents, moderatorId, moderators])

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
      // Prompt for any missing keys, one at a time (same UX as poker form).
      for (const profileId of profileIds) {
        if (keyring.has(profileId)) continue
        const profile = profiles.find((candidate) => candidate.id === profileId)
        const apiKey = prompt(`为 Profile "${profile?.displayName ?? profileId}" 填入 API Key:`)
        if (!apiKey?.trim()) throw new Error(`缺少 ${profile?.displayName ?? profileId} 的 API Key`)
        keyring.set(profileId, apiKey.trim())
      }

      const keyringPayload: Record<string, string> = {}
      for (const profileId of profileIds) {
        const apiKey = keyring.get(profileId)
        if (apiKey) keyringPayload[profileId] = apiKey
      }

      const result = await api.post<{ matchId: string; streamUrl: string }>('/api/matches', {
        gameType: 'werewolf',
        agentIds: selected,
        moderatorAgentId: moderatorId,
        config: { agentTimeoutMs, minActionIntervalMs },
        keyring: keyringPayload,
      })
      await uploadKeysForMatch(
        result.matchId,
        Object.entries(keyringPayload).map(([profileId, apiKey]) => ({ profileId, apiKey })),
      )
      router.push(`/matches/${result.matchId}`)
    } catch (err) {
      setError(String(err))
    } finally {
      setSubmitting(false)
    }
  }

  const canSubmit = selected.length === 6 && !!moderatorId && !submitting

  return (
    <div className="space-y-8">
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-white">① 选择 6 位玩家</h2>
          <Badge variant={selected.length === 6 ? 'default' : 'outline'}>{selected.length}/6</Badge>
        </div>
        {players.length < 6 ? (
          <p className="mb-3 text-sm text-destructive">
            至少需要 6 个 <code>gameType=werewolf, kind=player</code> 的 Agent;当前只有 {players.length} 个。
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
        <h2 className="mb-3 text-xl font-semibold text-white">② 主持人(Moderator)</h2>
        {moderators.length === 0 ? (
          <p className="mb-3 text-sm text-destructive">
            需要至少 1 个 <code>gameType=werewolf, kind=moderator</code> 的 Agent。去 /agents 创建一个。
          </p>
        ) : (
          <div className="max-w-md">
            <Label>选择主持人</Label>
            <Select value={moderatorId} onValueChange={setModeratorId}>
              <SelectTrigger>
                <SelectValue placeholder="选一个 moderator agent" />
              </SelectTrigger>
              <SelectContent>
                {moderators.map((mod) => (
                  <SelectItem key={mod.id} value={mod.id}>
                    {mod.avatarEmoji ?? '🎙️'} {mod.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-xl font-semibold text-white">③ 对局参数</h2>
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
        <h2 className="mb-3 text-xl font-semibold text-white">④ Key 检查</h2>
        {profileIds.length === 0 ? (
          <p className="text-sm text-muted-foreground">选择 Agent 和主持人后会显示本局需要的 Profile key。</p>
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
      <Button size="lg" onClick={submit} disabled={!canSubmit}>
        {submitting ? '创建中...' : '开始对局'}
      </Button>
    </div>
  )
}
