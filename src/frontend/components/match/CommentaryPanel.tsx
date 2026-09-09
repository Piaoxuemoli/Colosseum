'use client'

import { useMemo, useState } from 'react'
import { Loader2, Mic, RefreshCw, Sparkles } from 'lucide-react'
import { Badge } from '@/frontend/components/ui/badge'
import { Button } from '@/frontend/components/ui/button'
import type { GameEvent } from '@/platform/core/types'
import { api } from '@/frontend/lib/client/api'
import { keyring } from '@/frontend/lib/client/keyring'
import {
  findLatestCommentary,
  type CommentaryView,
} from '@/frontend/components/match/commentary-format'

/**
 * FR-4.7-02 赛后解说（R3-4）：结算区 / 回放摘要共用的「AI 赛后解说」面板。
 *
 * - 事实来源 = 留存事件流（FR-4.8-02）：已生成过解说（流中存在
 *   match/commentary 事件）则直接呈现，不重复调用 LLM；「重新生成」追加
 *   新事件并即时切换到新内容；
 * - 密钥口径：服务端 keyring 已随终局删除，解说由本面板从浏览器 keyring
 *   取本局某位参赛 Profile 的密钥随请求传入，仅本次调用使用（不落服务端）；
 * - 不虚构：每条亮点带 seq 徽标；回放上下文中点击即跳转到该事件时刻
 *   （onSeekToSeq），观众可逐条与事件流对照。
 */

type KeyStatusEntry = {
  profileId: string
  displayName: string
  model: string
  agentNames: string[]
  present: boolean
}

type CommentaryResponse = {
  matchId: string
  eventSeq: number
  commentary: CommentaryView['commentary']
  source: CommentaryView['source']
}

export function CommentaryPanel({
  matchId,
  events,
  agentNames,
  onSeekToSeq,
}: {
  matchId: string
  events: GameEvent[]
  /** agentId → 显示名（mvp 徽标与文案呈现用；缺省回落到 id）。 */
  agentNames?: Record<string, string>
  /** 回放上下文的跳转回调：把亮点引用的 seq 定位到回放光标。 */
  onSeekToSeq?: (seq: number) => void
}) {
  // SSR/留存的既有解说：有则直接呈现（幂等），不再触发 LLM。
  const persisted = useMemo(() => findLatestCommentary(events), [events])
  const [generated, setGenerated] = useState<CommentaryView | null>(null)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<{ message: string; retryable: boolean } | null>(null)

  const view = generated ?? persisted
  const nameOf = (agentId: string): string => agentNames?.[agentId] ?? agentId

  async function generate() {
    setGenerating(true)
    setError(null)
    try {
      // 从本局参赛 Profile 中挑一个本地 keyring 已存密钥的（key 只出浏览器）。
      const res = await fetch(`/api/matches/${matchId}/keys`)
      if (!res.ok) throw new Error(`密钥状态查询失败（HTTP ${res.status}）`)
      const status = (await res.json()) as { entries: KeyStatusEntry[] }
      const entry = status.entries.find((candidate) => keyring.has(candidate.profileId))
      if (!entry) {
        setError({
          message: '本地密钥缺失：请先在观战页顶部「密钥」中为任一参赛 Profile 录入 API Key（密钥只保存在你的浏览器）。',
          retryable: true,
        })
        return
      }
      const apiKey = keyring.get(entry.profileId)
      if (!apiKey) return

      const result = await api.raw.post<CommentaryResponse>(`/api/matches/${matchId}/commentary`, {
        profileId: entry.profileId,
        apiKey,
      })
      if (!result.ok) {
        const body = result.body as { error?: string; code?: string; retryable?: boolean }
        setError({
          message:
            body.error ??
            (result.status === 422 ? '解说与事件流对照未通过（不虚构校验），可重试。' : '解说生成失败。'),
          retryable: body.retryable ?? (result.status === 422 || result.status >= 500),
        })
        return
      }
      setGenerated({
        eventSeq: result.data.eventSeq,
        commentary: result.data.commentary,
        source: result.data.source,
      })
    } catch (err) {
      setError({ message: err instanceof Error ? err.message : String(err), retryable: true })
    } finally {
      setGenerating(false)
    }
  }

  if (!view) {
    return (
      <section
        className="rounded-lg border border-violet-300/20 bg-violet-400/[0.06] px-3 py-2.5"
        data-testid="commentary-panel-empty"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-medium text-violet-100">
            <Mic size={13} className="text-violet-300" aria-hidden="true" />
            AI 赛后解说
            <span className="text-[10px] font-normal text-muted-foreground">
              解说使用你本地保存的密钥（仅本次请求使用，不会保存到服务器）
            </span>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 rounded-md px-2.5 text-[11px]"
            disabled={generating}
            onClick={() => void generate()}
          >
            {generating ? (
              <>
                <Loader2 size={11} className="mr-1 animate-spin" aria-hidden="true" />
                解说生成中…
              </>
            ) : (
              <>
                <Sparkles size={11} className="mr-1" aria-hidden="true" />
                生成解说
              </>
            )}
          </Button>
        </div>
        {error ? <ErrorNote message={error.message} /> : null}
      </section>
    )
  }

  const { commentary, source } = view
  return (
    <section
      className="rounded-lg border border-violet-300/25 bg-violet-400/[0.06] px-3 py-3"
      data-testid="commentary-panel"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-violet-100">
          <Mic size={13} className="text-violet-300" aria-hidden="true" />
          AI 赛后解说
          <Badge variant="outline" className="h-5 border-violet-300/30 px-1.5 text-[10px] text-violet-200">
            {source.model}
            {source.providerHost ? ` · ${source.providerHost}` : ''}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground" title={source.createdAt}>
            {source.createdAt.slice(0, 16).replace('T', ' ')}
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 rounded-md px-2 text-[10px]"
            disabled={generating}
            onClick={() => void generate()}
          >
            {generating ? (
              <Loader2 size={11} className="mr-1 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw size={11} className="mr-1" aria-hidden="true" />
            )}
            重新生成
          </Button>
        </div>
      </div>

      <div className="mt-2 text-sm font-bold leading-snug text-white" data-testid="commentary-headline">
        {commentary.headline}
      </div>
      <p className="mt-1.5 text-xs leading-5 text-slate-200/90" data-testid="commentary-summary">
        {commentary.summary}
      </p>

      <div className="mt-2.5 space-y-1.5" data-testid="commentary-highlights">
        {commentary.highlights.map((highlight) => {
          const content = (
            <>
              <span className="shrink-0 rounded border border-violet-300/30 bg-violet-500/15 px-1.5 py-0.5 font-mono text-[10px] text-violet-200">
                #{highlight.seq}
              </span>
              <span className="shrink-0 text-xs font-semibold text-violet-50">{highlight.title}</span>
              <span className="min-w-0 text-xs leading-5 text-slate-200/85">{highlight.text}</span>
            </>
          )
          if (onSeekToSeq) {
            return (
              <button
                key={`${highlight.seq}-${highlight.title}`}
                type="button"
                onClick={() => onSeekToSeq(highlight.seq)}
                title="跳转到该事件时刻"
                className="flex w-full items-start gap-2 rounded-md border border-transparent px-1.5 py-1 text-left transition hover:border-violet-300/25 hover:bg-violet-400/10"
              >
                {content}
              </button>
            )
          }
          return (
            <div key={`${highlight.seq}-${highlight.title}`} className="flex items-start gap-2 px-1.5 py-1">
              {content}
            </div>
          )
        })}
      </div>

      {commentary.mvp ? (
        <div
          className="mt-2 flex flex-wrap items-center gap-1.5 rounded-md border border-amber-300/25 bg-amber-400/10 px-2 py-1.5 text-xs"
          data-testid="commentary-mvp"
        >
          <Badge className="h-5 bg-amber-400/90 px-1.5 text-[10px] font-bold text-amber-950">MVP</Badge>
          <span className="font-semibold text-amber-100">{nameOf(commentary.mvp.agentId)}</span>
          <span className="text-amber-100/80">{commentary.mvp.reason}</span>
        </div>
      ) : null}

      <div className="mt-2 text-[10px] text-muted-foreground">
        亮点均引用本局真实事件（#seq 可在回放中定位对照）；重新生成使用你本地保存的密钥，仅本次请求使用。
      </div>
      {error ? <ErrorNote message={error.message} /> : null}
    </section>
  )
}

function ErrorNote({ message }: { message: string }) {
  return (
    <div
      className="mt-2 rounded-md border border-red-400/25 bg-red-500/[0.08] px-2 py-1.5 text-[11px] text-red-100"
      data-testid="commentary-error"
      role="alert"
    >
      {message}
    </div>
  )
}
