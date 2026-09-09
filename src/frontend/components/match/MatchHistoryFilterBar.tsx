'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2, Search, X } from 'lucide-react'

const GAME_TABS = [
  { value: '', label: '全部游戏' },
  { value: 'poker', label: '德州扑克' },
  { value: 'werewolf', label: '狼人杀' },
  { value: 'avalon', label: '阿瓦隆' },
] as const

const STATUS_OPTIONS = [
  { value: '', label: '全部状态' },
  { value: 'running', label: '进行中' },
  { value: 'completed', label: '已完成' },
  { value: 'errored', label: '异常结束' },
  { value: 'aborted_by_errors', label: '连续错误中止' },
] as const

/**
 * FR-4.6-04 历史过滤检索条（紧凑控制台样式）：品类 tabs + 状态选择 +
 * 关键词输入。过滤状态同步进 URL（?gameType=&status=&q=），服务端组件
 * 读同一份参数渲染结果——刷新/分享链接后过滤保持。
 */
export function MatchHistoryFilterBar() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()

  const urlGameType = searchParams.get('gameType') ?? ''
  const urlStatus = searchParams.get('status') ?? ''
  const urlQuery = searchParams.get('q') ?? ''

  const [draft, setDraft] = useState(urlQuery)
  useEffect(() => {
    setDraft(urlQuery)
  }, [urlQuery])

  function pushParams(next: { gameType?: string; status?: string; q?: string | null }) {
    const params = new URLSearchParams(searchParams.toString())
    const apply = (key: string, value: string | null | undefined) => {
      if (value) params.set(key, value)
      else params.delete(key)
    }
    apply('gameType', next.gameType !== undefined ? next.gameType : urlGameType)
    apply('status', next.status !== undefined ? next.status : urlStatus)
    apply('q', next.q !== undefined ? next.q : urlQuery)
    const query = params.toString()
    startTransition(() => {
      router.replace(query ? `/?${query}#recent` : '/#recent', { scroll: false })
    })
  }

  const hasFilter = Boolean(urlGameType || urlStatus || urlQuery)

  return (
    <div
      className="mb-4 flex flex-col gap-2 rounded-xl border border-white/10 bg-slate-950/45 p-2.5 md:flex-row md:items-center"
      data-testid="match-history-filter-bar"
    >
      <div className="flex shrink-0 items-center gap-1" role="group" aria-label="按游戏品类过滤">
        {GAME_TABS.map((tab) => {
          const selected = urlGameType === tab.value
          return (
            <button
              key={tab.value || '__all__'}
              type="button"
              aria-pressed={selected}
              onClick={() => pushParams({ gameType: tab.value })}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                selected
                  ? 'border border-cyan-300/50 bg-cyan-300/15 text-cyan-100'
                  : 'border border-transparent text-muted-foreground hover:bg-white/5 hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      <select
        value={urlStatus}
        onChange={(e) => pushParams({ status: e.target.value })}
        aria-label="按状态过滤"
        className="shrink-0 rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-200"
      >
        {STATUS_OPTIONS.map((option) => (
          <option key={option.value || '__all__'} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      <form
        className="flex min-w-0 flex-1 items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault()
          pushParams({ q: draft.trim() || null })
        }}
      >
        <div className="relative min-w-0 flex-1">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="搜索对局 ID 或参赛 Agent"
            aria-label="搜索对局"
            className="w-full rounded-lg border border-neutral-700 bg-neutral-900 py-1.5 pl-8 pr-2 text-xs text-neutral-200 placeholder:text-neutral-500"
          />
        </div>
        {hasFilter ? (
          <button
            type="button"
            onClick={() => {
              setDraft('')
              pushParams({ gameType: '', status: '', q: null })
            }}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-muted-foreground transition hover:text-slate-200"
          >
            <X size={13} aria-hidden="true" />
            清除
          </button>
        ) : null}
        {pending ? <Loader2 size={14} className="shrink-0 animate-spin text-cyan-300" aria-hidden="true" /> : null}
      </form>
    </div>
  )
}
