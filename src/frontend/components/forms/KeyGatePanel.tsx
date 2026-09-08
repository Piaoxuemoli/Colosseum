'use client'

import { AlertTriangle, KeyRound, ShieldAlert } from 'lucide-react'
import { Button } from '@/frontend/components/ui/button'
import { KeyStatusBadge, KEY_STATUS_LABELS } from '@/frontend/components/keys/KeyStatusBadge'
import { isBlockingKeyStatus, isUnhealthyKeyStatus, type KeyStatus } from '@/frontend/lib/client/keyring'

/**
 * 赛前密钥检查面板（FR-4.1-03：赛前警示 / 阻断）。
 *
 * 供德州扑克与狼人杀两个组局表单共用：
 * - 逐 Profile 展示密钥健康状态（可用 / 即将过期 / 已过期 / 未配置）；
 * - 缺失或已过期 → 阻断级警示，列出受影响 Agent，开始按钮被禁用，
 *   直到用户「补充密钥」修复，或显式点「仍要开始」确认接受规则兜底
 *   （阻断的含义是必须有一个明确动作，不是静默放行）；
 * - 即将过期 → 仅警示，不阻断。
 */

export type KeyGateProfile = {
  profileId: string
  profileName: string
  model?: string
  agentNames: string[]
  status: KeyStatus
}

export function hasBlockingKey(profiles: KeyGateProfile[]): boolean {
  return profiles.some((profile) => isBlockingKeyStatus(profile.status))
}

export function hasUnhealthyKey(profiles: KeyGateProfile[]): boolean {
  return profiles.some((profile) => isUnhealthyKeyStatus(profile.status))
}

export function KeyGatePanel({
  profiles,
  acknowledged,
  onAcknowledge,
  onSupplyKey,
}: {
  profiles: KeyGateProfile[]
  /** 用户已显式确认「仍要开始（接受兜底）」。 */
  acknowledged: boolean
  onAcknowledge: () => void
  /** 补充 / 更换某个 Profile 的密钥（由表单负责 prompt + keyring.set + 重算状态）。 */
  onSupplyKey: (profileId: string) => void
}) {
  const blocking = hasBlockingKey(profiles)
  const blockingProfiles = profiles.filter((profile) => isBlockingKeyStatus(profile.status))
  const expiringProfiles = profiles.filter((profile) => profile.status === 'expiring')

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {profiles.map((profile) => (
          <div
            key={profile.profileId}
            className={`flex flex-wrap items-center gap-2 rounded-lg border p-2.5 text-sm ${
              isBlockingKeyStatus(profile.status)
                ? 'border-red-400/25 bg-red-500/[0.06]'
                : 'border-white/10 bg-slate-950/40'
            }`}
          >
            <KeyStatusBadge status={profile.status} />
            <span className="min-w-0">
              <span className="font-medium text-white">{profile.profileName}</span>
              {profile.model ? <span className="ml-2 font-mono text-xs text-muted-foreground">{profile.model}</span> : null}
            </span>
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={profile.agentNames.join('、')}>
              使用者：{profile.agentNames.length > 0 ? profile.agentNames.join('、') : '（未选择 Agent）'}
            </span>
            {isBlockingKeyStatus(profile.status) ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 rounded-md px-2.5"
                onClick={() => onSupplyKey(profile.profileId)}
              >
                <KeyRound size={12} aria-hidden="true" />
                {profile.status === 'expired' ? '更换密钥' : '补充密钥'}
              </Button>
            ) : null}
          </div>
        ))}
      </div>

      {blocking ? (
        <div
          role="alert"
          className="rounded-lg border border-red-400/30 bg-red-500/10 p-3"
        >
          <div className="flex items-start gap-2">
            <ShieldAlert size={16} className="mt-0.5 shrink-0 text-red-300" aria-hidden="true" />
            <div className="min-w-0 flex-1 space-y-2 text-sm">
              <div className="font-medium text-red-100">
                {blockingProfiles.length} 个 Profile 的密钥{blockingProfiles.some((p) => p.status === 'missing') && blockingProfiles.some((p) => p.status === 'expired') ? '缺失或已过期' : blockingProfiles[0].status === 'missing' ? '缺失' : '已过期'}
                ，对应 Agent 开局后将直接使用规则兜底，无法调用 LLM。
              </div>
              <ul className="list-disc space-y-0.5 pl-5 text-xs leading-5 text-red-200/90">
                {blockingProfiles.map((profile) => (
                  <li key={profile.profileId}>
                    {profile.profileName}（{KEY_STATUS_LABELS[profile.status]}）：
                    {profile.agentNames.length > 0 ? profile.agentNames.join('、') : '未绑定 Agent'}
                  </li>
                ))}
              </ul>
              {acknowledged ? (
                <div className="flex items-center gap-2 text-xs text-amber-200">
                  <AlertTriangle size={12} aria-hidden="true" />
                  已确认仍要开始，缺失密钥的 Agent 将使用规则兜底。
                </div>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="h-7 rounded-md border border-amber-400/30 px-2.5 text-amber-100 hover:bg-amber-500/10"
                  onClick={onAcknowledge}
                >
                  仍要开始（接受规则兜底）
                </Button>
              )}
            </div>
          </div>
        </div>
      ) : expiringProfiles.length > 0 ? (
        <div
          role="status"
          className="flex items-start gap-2 rounded-lg border border-amber-400/25 bg-amber-500/[0.08] p-3 text-sm text-amber-100"
        >
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            {expiringProfiles.map((profile) => profile.profileName).join('、')} 的本地密钥即将过期（距上次录入超过
            22 小时）。建议赛前{expiringProfiles.length > 1 ? '逐个' : ''}更换，避免对局中途鉴权失败。
          </div>
        </div>
      ) : (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <KeyRound size={12} aria-hidden="true" />
          全部密钥可用；密钥仅存于本浏览器，开局时上传到本对局（服务端 24h 后自动清除）。
        </p>
      )}
    </div>
  )
}
