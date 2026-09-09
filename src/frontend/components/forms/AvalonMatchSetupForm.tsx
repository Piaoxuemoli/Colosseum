'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/frontend/components/ui/badge'
import { Button } from '@/frontend/components/ui/button'
import { Card, CardContent } from '@/frontend/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/frontend/components/ui/select'
import { Input } from '@/frontend/components/ui/input'
import { Label } from '@/frontend/components/ui/label'
import { KeyGatePanel, hasBlockingKey, type KeyGateProfile } from '@/frontend/components/forms/KeyGatePanel'
import {
  AVALON_BOARD_PRESETS,
  AVALON_DEFAULT_PRESET_ID,
  avalonPresetRoleSummary,
  findAvalonPreset,
} from '@/frontend/components/match/avalon-format'
import { api } from '@/frontend/lib/client/api'
import { keyring, keyringStatus, type KeyStatus } from '@/frontend/lib/client/keyring'
import { toast } from '@/frontend/lib/client/toast'

/**
 * 阿瓦隆对局创建（avalon-frontend PRD §4，全量化）：
 * - 板子预设选择器（10 预设：5/6 人核心板 + 7–10 人扩展板），选中即展示
 *   阵营构成 / 任务人数表 / 双失败轮说明（与引擎侧同表，AVR-601）；
 * - 玩家人数随板子联动（5 或 6 或 7–10；硬校验在服务端，前端做联动与提示）；
 * - 主持人 Agent 可选（默认无，AVR-OD-6）；
 * - 赛前密钥健康检查与上传链路复用平台机制（FR-4.1-03），无阿瓦隆特例。
 *
 * 提交 payload：config 增加 { preset }（默认 basic-5）；有 moderator 时随
 * moderatorAgentId 传（参照 werewolf 表单传法）。
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

const NO_MODERATOR = 'none'

export function AvalonMatchSetupForm() {
  const router = useRouter()
  const [players, setPlayers] = useState<Agent[]>([])
  const [moderators, setModerators] = useState<Agent[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [presetId, setPresetId] = useState<string>(AVALON_DEFAULT_PRESET_ID)
  const [moderatorId, setModeratorId] = useState<string>(NO_MODERATOR)
  const [keyStatuses, setKeyStatuses] = useState<Record<string, KeyStatus>>({})
  const [keysAcknowledged, setKeysAcknowledged] = useState(false)
  const [agentTimeoutMs, setAgentTimeoutMs] = useState(180_000)
  const [minActionIntervalMs, setMinActionIntervalMs] = useState(1_000)
  const [submitting, setSubmitting] = useState(false)
  const [navigating, setNavigating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const preset = useMemo(() => findAvalonPreset(presetId), [presetId])

  useEffect(() => {
    void (async () => {
      const [playerResult, moderatorResult, profileResult] = await Promise.all([
        api.get<{ agents: Agent[] }>('/api/agents?gameType=avalon&kind=player'),
        api.get<{ agents: Agent[] }>('/api/agents?gameType=avalon&kind=moderator'),
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
  const moderator = useMemo(
    () => moderators.find((mod) => mod.id === moderatorId && moderatorId !== NO_MODERATOR),
    [moderatorId, moderators],
  )
  const profileIds = useMemo(() => {
    const ids = new Set<string>()
    for (const agent of selectedAgents) ids.add(agent.profileId)
    if (moderator) ids.add(moderator.profileId)
    return Array.from(ids)
  }, [selectedAgents, moderator])

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
        const agentsUsing = [...selectedAgents, ...(moderator && moderator.profileId === profileId ? [moderator] : [])]
        return {
          profileId,
          profileName: profile?.displayName ?? profileId,
          model: profile?.model,
          agentNames: agentsUsing
            .filter((agent) => agent.profileId === profileId)
            .map((agent) => (agent.kind === 'moderator' ? `${agent.displayName}(主持人)` : agent.displayName)),
          status: keyStatuses[profileId] ?? 'missing',
        }
      }),
    [profileIds, profiles, selectedAgents, moderator, keyStatuses],
  )

  const blockingKeys = hasBlockingKey(gateProfiles)
  // 阻断名单一变（改选玩家 / 主持人 / 预设 / 换 key），此前的「仍要开始」确认作废。
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

  function selectPreset(nextId: string) {
    setPresetId(nextId)
    // 人数联动：切换到更小的板子时截断多出的选择。
    const nextPreset = findAvalonPreset(nextId)
    setSelected((previous) => previous.slice(0, nextPreset.playerCount))
  }

  function toggleSelect(id: string) {
    setSelected((previous) => {
      if (previous.includes(id)) return previous.filter((candidate) => candidate !== id)
      if (previous.length >= preset.playerCount) return previous
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
        moderatorAgentId: moderator ? moderator.id : undefined,
        config: { agentTimeoutMs, minActionIntervalMs },
        // 板子预设走 engineConfig（API 的 config 是严格调度参数对象，自由
        // 字段会被剥离）；与狼人杀 boardId 同通道。
        engineConfig: { preset: preset.id },
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
    selected.length === preset.playerCount &&
    !submitting &&
    !navigating &&
    (!blockingKeys || keysAcknowledged)

  const presetSummary = avalonPresetRoleSummary(preset)

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 text-xl font-semibold text-white">① 选择板子预设</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {AVALON_BOARD_PRESETS.map((candidate) => {
            const isSelected = candidate.id === preset.id
            const summary = avalonPresetRoleSummary(candidate)
            return (
              <Card
                key={candidate.id}
                data-testid={`avalon-preset-${candidate.id}`}
                className={`cursor-pointer transition ${
                  isSelected ? 'border-cyan-300/60 bg-cyan-300/10' : 'hover:border-cyan-300/30'
                }`}
                onClick={() => selectPreset(candidate.id)}
              >
                <CardContent className="flex flex-col gap-2 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-semibold text-white">
                      {candidate.name}
                      <span className="ml-2 font-mono text-xs text-muted-foreground">{candidate.playerCount} 人</span>
                    </div>
                    {candidate.extension ? (
                      <Badge variant="outline" className="shrink-0 text-[10px]">
                        扩展板：7–10 人，引擎测试覆盖
                      </Badge>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    好 {candidate.goodCount}（{summary.good}）vs 坏 {candidate.evilCount}（{summary.evil}）
                  </p>
                  <p className="font-mono text-xs text-slate-300">
                    任务人数：{candidate.teamSizes.join(' / ')}
                    {isSelected ? <span className="ml-2 text-cyan-200">✓ 已选</span> : null}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {candidate.doubleFailRounds.length > 0
                      ? `双失败轮：第 ${candidate.doubleFailRounds.join('、')} 轮需 2 张失败牌才判失败`
                      : '双失败轮：无（每轮 1 张失败牌即判失败）'}
                  </p>
                </CardContent>
              </Card>
            )
          })}
        </div>
        <p className="mt-3 text-sm text-muted-foreground" data-testid="avalon-preset-detail">
          当前板子：<span className="font-semibold text-white">{preset.name}</span> · 好 {preset.goodCount} / 坏{' '}
          {preset.evilCount}（{presetSummary.good} vs {presetSummary.evil}）· 5 轮任务 3 胜制 · 连续 5 次拒绝提案坏人直接获胜。
        </p>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-white">② 选择 {preset.playerCount} 位玩家</h2>
          <Badge variant={selected.length === preset.playerCount ? 'default' : 'outline'}>
            {selected.length}/{preset.playerCount}
          </Badge>
        </div>
        {players.length < preset.playerCount ? (
          <p className="mb-3 text-sm text-destructive">
            至少需要 {preset.playerCount} 个 <code>gameType=avalon, kind=player</code> 的 Agent;当前只有 {players.length} 个。
          </p>
        ) : null}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {players.map((agent) => {
            const isSelected = selected.includes(agent.id)
            const order = isSelected ? selected.indexOf(agent.id) + 1 : 0
            const disabled = !isSelected && selected.length >= preset.playerCount
            return (
              <Card
                key={agent.id}
                className={`cursor-pointer transition ${
                  isSelected
                    ? 'border-cyan-300/60 bg-cyan-300/10'
                    : disabled
                      ? 'opacity-50'
                      : 'hover:border-cyan-300/30'
                }`}
                onClick={() => {
                  if (!disabled) toggleSelect(agent.id)
                }}
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
        <h2 className="mb-3 text-xl font-semibold text-white">③ 主持人（可选）</h2>
        {moderators.length === 0 ? (
          <p className="mb-3 text-sm text-muted-foreground">
            未配置 <code>gameType=avalon, kind=moderator</code> 的 Agent——默认无主持人，纯流程事件照发；可在 /agents 创建后选用。
          </p>
        ) : (
          <div className="max-w-md">
            <Label>选择主持人</Label>
            <Select value={moderatorId} onValueChange={setModeratorId}>
              <SelectTrigger>
                <SelectValue placeholder="无主持人（默认）" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_MODERATOR}>无主持人（默认）</SelectItem>
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
        <h2 className="mb-3 text-xl font-semibold text-white">④ 对局参数</h2>
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
        <h2 className="mb-3 text-xl font-semibold text-white">⑤ Key 检查</h2>
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
