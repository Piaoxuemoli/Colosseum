'use client'

import { useCallback, useEffect, useState } from 'react'
import { KeyRound, Loader2, ShieldAlert, UploadCloud } from 'lucide-react'
import { Badge } from '@/frontend/components/ui/badge'
import { Button } from '@/frontend/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/frontend/components/ui/popover'
import { KeyStatusBadge } from '@/frontend/components/keys/KeyStatusBadge'
import { isUnhealthyKeyStatus, keyring, uploadKeysForMatch, type KeyStatus } from '@/frontend/lib/client/keyring'
import { onOpenKeyStatus } from '@/frontend/lib/client/key-status-events'
import { toast } from '@/frontend/lib/client/toast'

/**
 * 观战页顶栏的密钥状态徽章（FR-4.1-03）。
 *
 * - 徽章：`密钥 N/M`（N = 服务端本局 keyring 已有的 Profile 数）；
 * - 点击展开浮层：逐 Profile 的服务端/本地状态 + 「重新上传」入口
 *   （复用 uploadKeysForMatch，即赛后中途补 key 的唯一通道）；
 * - 错误条目（ErrorBadge）里的一键「重新上传密钥」通过
 *   requestOpenKeyStatus() 直接唤起本浮层。
 */

type KeyStatusEntry = {
  profileId: string
  displayName: string
  model: string
  agentNames: string[]
  present: boolean
}

type KeyStatusResponse = { matchId: string; gameType: string; entries: KeyStatusEntry[] }

export function MatchKeyStatusBadge({ matchId }: { matchId: string }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [entries, setEntries] = useState<KeyStatusEntry[]>([])
  const [localStatuses, setLocalStatuses] = useState<Record<string, KeyStatus>>({})
  const [uploadingId, setUploadingId] = useState<string | null>(null)
  const [uploadingAll, setUploadingAll] = useState(false)

  const refreshLocalStatuses = useCallback(() => {
    setLocalStatuses(keyring.status())
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/matches/${matchId}/keys`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as KeyStatusResponse
      setEntries(json.entries)
      setFailed(false)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
      refreshLocalStatuses()
    }
  }, [matchId, refreshLocalStatuses])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // 错误条目上的「重新上传密钥」→ 直接唤起本浮层。
  useEffect(() => onOpenKeyStatus(() => setOpen(true)), [])

  const presentCount = entries.filter((entry) => entry.present).length
  const totalCount = entries.length
  const missingOnServer = entries.filter((entry) => !entry.present)
  const locallyAvailable = missingOnServer.filter((entry) => keyring.has(entry.profileId))

  async function reupload(entry: KeyStatusEntry) {
    let apiKey = keyring.get(entry.profileId)
    if (!apiKey) {
      const input = prompt(`为 Profile "${entry.displayName}" 填入 API Key：`)
      apiKey = input?.trim()
      if (!apiKey) return
      keyring.set(entry.profileId, apiKey)
    }
    setUploadingId(entry.profileId)
    try {
      await uploadKeysForMatch(matchId, [{ profileId: entry.profileId, apiKey }])
      toast.success('密钥已上传', `Profile "${entry.displayName}" 的密钥已上传到本对局，后续回合即生效。`)
      await refresh()
    } catch (err) {
      toast.error('上传失败', err instanceof Error ? err.message : String(err))
    } finally {
      setUploadingId(null)
    }
  }

  async function reuploadAllLocal() {
    const uploads = locallyAvailable.map((entry) => ({
      profileId: entry.profileId,
      apiKey: keyring.get(entry.profileId) ?? '',
    }))
    if (uploads.length === 0) return
    setUploadingAll(true)
    try {
      await uploadKeysForMatch(matchId, uploads)
      toast.success('密钥已上传', `${uploads.length} 个 Profile 的本地密钥已上传到本对局。`)
      await refresh()
    } catch (err) {
      toast.error('上传失败', err instanceof Error ? err.message : String(err))
    } finally {
      setUploadingAll(false)
    }
  }

  const badgeVariant = !failed && totalCount > 0 && presentCount < totalCount ? 'danger' : loading ? 'muted' : 'ok'

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) void refresh()
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="查看本局密钥状态"
          className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs transition hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <KeyRound size={14} aria-hidden="true" className={badgeVariant === 'danger' ? 'text-red-300' : 'text-cyan-200'} />
          {loading ? (
            <span className="text-muted-foreground">密钥 …</span>
          ) : failed ? (
            <span className="text-amber-300">密钥 ?</span>
          ) : (
            <span className={presentCount < totalCount ? 'font-semibold text-red-200' : 'text-slate-200'}>
              密钥 {presentCount}/{totalCount}
            </span>
          )}
          {badgeVariant === 'danger' ? <ShieldAlert size={12} className="text-red-300" aria-hidden="true" /> : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="thin-scrollbar max-h-[min(70vh,32rem)] w-[24rem] max-w-[calc(100vw-2rem)] overflow-y-auto">
        <div className="mb-3">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200">Keyring</div>
          <div className="mt-1 text-sm font-semibold text-slate-100">本局密钥状态</div>
          <div className="mt-1 text-xs leading-5 text-muted-foreground">
            密钥仅存于你的浏览器，开局 / 补传时上传到本局服务端，24 小时后自动清除。
          </div>
        </div>

        {failed ? (
          <div className="space-y-2 rounded-lg border border-amber-400/25 bg-amber-500/[0.08] p-3 text-xs text-amber-100">
            密钥状态查询失败（服务端不可达或对局已清理）。
            <Button type="button" size="sm" variant="secondary" className="ml-2 h-6 rounded-md px-2" onClick={() => void refresh()}>
              重试
            </Button>
          </div>
        ) : loading && entries.length === 0 ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 size={12} className="animate-spin" aria-hidden="true" />
            加载中…
          </div>
        ) : entries.length === 0 ? (
          <div className="text-xs text-muted-foreground">本局没有需要密钥的参赛 Agent。</div>
        ) : (
          <div className="space-y-2">
            {entries.map((entry) => {
              const localStatus = localStatuses[entry.profileId] ?? 'missing'
              const busy = uploadingId === entry.profileId
              return (
                <div
                  key={entry.profileId}
                  className={`rounded-lg border p-2.5 text-xs ${
                    entry.present ? 'border-white/10 bg-slate-950/50' : 'border-red-400/25 bg-red-500/[0.06]'
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 truncate font-semibold text-slate-100">{entry.displayName}</span>
                    <span className="truncate font-mono text-[10px] text-muted-foreground">{entry.model}</span>
                  </div>
                  <div className="mt-1 truncate text-[11px] text-muted-foreground" title={entry.agentNames.join('、')}>
                    {entry.agentNames.join('、') || '（无 Agent）'}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <Badge
                      variant="outline"
                      className={
                        entry.present
                          ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200'
                          : 'border-red-400/30 bg-red-500/10 text-red-200'
                      }
                    >
                      服务端{entry.present ? '已上传' : '未上传'}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">本地</span>
                    <KeyStatusBadge status={localStatus} />
                    {isUnhealthyKeyStatus(localStatus) ? (
                      <span className="text-[10px] text-muted-foreground">（重传时会要求先更新本地密钥）</span>
                    ) : null}
                  </div>
                  {!entry.present || isUnhealthyKeyStatus(localStatus) ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="mt-2 h-6 rounded-md px-2 text-[11px]"
                      disabled={busy}
                      onClick={() => void reupload(entry)}
                    >
                      {busy ? (
                        <>
                          <Loader2 size={11} className="mr-1 animate-spin" aria-hidden="true" />
                          上传中
                        </>
                      ) : (
                        <>
                          <UploadCloud size={11} aria-hidden="true" className="mr-1" />
                          {localStatus === 'ok' ? '重新上传' : '上传密钥'}
                        </>
                      )}
                    </Button>
                  ) : null}
                </div>
              )
            })}

            {locallyAvailable.length > 1 ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="h-7 w-full rounded-md px-2 text-[11px]"
                disabled={uploadingAll}
                onClick={() => void reuploadAllLocal()}
              >
                {uploadingAll ? (
                  <>
                    <Loader2 size={11} className="mr-1 animate-spin" aria-hidden="true" />
                    上传中
                  </>
                ) : (
                  <>
                    <UploadCloud size={11} aria-hidden="true" className="mr-1" />
                    一键上传本地已有密钥（{locallyAvailable.length}）
                  </>
                )}
              </Button>
            ) : null}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
