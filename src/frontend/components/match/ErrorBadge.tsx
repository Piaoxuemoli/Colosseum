'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Bot, Clock, RotateCcw } from 'lucide-react'
import { Badge } from '@/frontend/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/frontend/components/ui/popover'
import { useMatchViewStore } from '@/frontend/store/match-view-store'

type ErrorItem = {
  id: string
  agentId: string
  agentName: string
  layer: string
  errorCode: string
  occurredAt: string
  rawResponse?: string | null
  recoveryAction?: Record<string, unknown> | null
}

const ERROR_LABELS: Record<string, { title: string; hint: string }> = {
  'llm-parse_fail': {
    title: 'LLM 输出解析失败',
    hint: '模型回复里没有提取到合法动作 JSON，系统已使用规则 Bot 兜底。',
  },
  'llm-invalid-action': {
    title: 'LLM 动作不合法',
    hint: '模型给出了动作，但不符合当前可行动作集合，系统已校正或兜底。',
  },
  'llm-api-key-missing': {
    title: 'API Key 缺失',
    hint: '本局没有可用密钥，Agent 改用规则 Bot。',
  },
  'llm-profile-missing': {
    title: 'Profile 缺失',
    hint: 'Agent 绑定的模型配置不存在，系统改用规则 Bot。',
  },
  'agent-token-missing': {
    title: '对局 Token 缺失',
    hint: 'GM 无法调用 Agent endpoint，系统改用规则 Bot。',
  },
  'agent-no-action': {
    title: 'Agent 未返回动作',
    hint: 'Agent endpoint 完成但没有产出 action 字段，系统改用规则 Bot。',
  },
  'agent-endpoint-failed': {
    title: 'Agent endpoint 调用失败',
    hint: 'GM 请求 Agent endpoint 报错或超时，系统改用规则 Bot。',
  },
  'agent-invalid-action': {
    title: 'Agent 动作校验失败',
    hint: '最终动作没有通过 GM 校验，系统已执行恢复动作。',
  },
}

const LAYER_LABELS: Record<string, string> = {
  http: 'HTTP/A2A 调用',
  structured: '结构化输出',
  parse: '动作解析',
  validate: '动作校验',
  fallback: '兜底恢复',
}

function errorMeta(code: string): { title: string; hint: string } {
  return ERROR_LABELS[code] ?? {
    title: code,
    hint: '未知错误类型，请查看原始响应和恢复动作。',
  }
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function formatJson(value: unknown): string {
  if (!value) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export function ErrorBadge({ matchId }: { matchId: string }) {
  const errorCount = useMatchViewStore((state) => state.errorCount)
  const setErrorCount = useMatchViewStore((state) => state.setErrorCount)
  const [items, setItems] = useState<ErrorItem[]>([])

  useEffect(() => {
    let cancelled = false

    async function refresh() {
      const res = await fetch(`/api/matches/${matchId}/errors`)
      if (!res.ok) return
      const json = (await res.json()) as { count: number; errors: ErrorItem[] }
      if (cancelled) return
      setItems(json.errors)
      setErrorCount(json.count)
    }

    void refresh()
    const timer = setInterval(() => void refresh(), 5_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [matchId, setErrorCount])

  const groups = useMemo(() => {
    const out = new Map<string, ErrorItem[]>()
    for (const item of items) {
      const list = out.get(item.errorCode) ?? []
      list.push(item)
      out.set(item.errorCode, list)
    }
    return Array.from(out.entries()).sort((a, b) => b[1].length - a[1].length)
  }, [items])

  if (errorCount === 0) return null

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-red-300 transition hover:bg-red-500/10">
          <AlertTriangle size={14} />
          <Badge variant="destructive">{errorCount}</Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="thin-scrollbar max-h-[min(70vh,36rem)] w-[32rem] max-w-[calc(100vw-2rem)] overflow-y-auto">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-red-200">Agent Debug</div>
            <div className="mt-1 text-sm font-semibold text-slate-100">错误与兜底记录</div>
          </div>
          <Badge variant="destructive">{errorCount} 条</Badge>
        </div>
        {groups.length === 0 ? (
          <div className="text-xs text-muted-foreground">暂无错误</div>
        ) : (
          <div className="space-y-3">
            {groups.map(([code, list]) => (
              <details key={code} className="rounded-xl border border-red-400/20 bg-red-500/10 p-3" open>
                <summary className="cursor-pointer list-none">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-red-100">{errorMeta(code).title}</span>
                        <span className="rounded-full border border-red-300/20 bg-red-950/40 px-2 py-0.5 font-mono text-[10px] text-red-200">
                          {code}
                        </span>
                      </div>
                      <div className="mt-1 text-xs leading-5 text-muted-foreground">{errorMeta(code).hint}</div>
                    </div>
                    <Badge variant="destructive">× {list.length}</Badge>
                  </div>
                </summary>
                <ul className="mt-3 space-y-2">
                  {list.slice(0, 6).map((item) => (
                    <li
                      key={item.id}
                      className="rounded-lg border border-white/10 bg-slate-950/65 p-2.5 text-xs"
                    >
                      <div className="flex flex-wrap items-center gap-2 text-slate-200">
                        <Bot size={13} className="text-cyan-200" aria-hidden="true" />
                        <span className="font-semibold">{item.agentName}</span>
                        <span className="font-mono text-[10px] text-muted-foreground">{item.agentId}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                        <span>{LAYER_LABELS[item.layer] ?? item.layer}</span>
                        <span>·</span>
                        <Clock size={11} aria-hidden="true" />
                        <span>{formatTime(item.occurredAt)}</span>
                      </div>

                      {item.recoveryAction ? (
                        <div className="mt-2 rounded-md border border-cyan-300/15 bg-cyan-300/[0.06] p-2">
                          <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-100">
                            <RotateCcw size={11} aria-hidden="true" />
                            恢复动作
                          </div>
                          <pre className="thin-scrollbar max-h-24 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-cyan-50/85">
                            {formatJson(item.recoveryAction)}
                          </pre>
                        </div>
                      ) : null}

                      {item.rawResponse ? (
                        <div className="mt-2 rounded-md border border-white/10 bg-black/25 p-2">
                          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-300">
                            原始响应片段
                          </div>
                          <pre className="thin-scrollbar max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-muted-foreground">
                            {String(item.rawResponse).slice(0, 800)}
                          </pre>
                        </div>
                      ) : null}
                    </li>
                  ))}
                  {list.length > 6 ? (
                    <li className="text-[11px] text-muted-foreground">还有 {list.length - 6} 条同类错误未展开显示。</li>
                  ) : null}
                </ul>
              </details>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
