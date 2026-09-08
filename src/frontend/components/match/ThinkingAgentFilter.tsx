'use client'

import { useMemo } from 'react'
import { useThinkingStore } from '@/frontend/store/thinking-store'

/**
 * FR-4.6-03 思考链回放过滤：按选手过滤思考历史的 chips（全部 + 每位选手）。
 * 过滤状态存于 thinking-store（`agentFilter`），live 思考日志与回放思考
 * 视图共用——狼人杀的思考日志组件（games 侧）通过 store 派生视图自动生效。
 */
export function ThinkingAgentFilter() {
  const allHistory = useThinkingStore((s) => s.allHistory)
  const allCurrent = useThinkingStore((s) => s.allCurrent)
  const agentFilter = useThinkingStore((s) => s.agentFilter)
  const setAgentFilter = useThinkingStore((s) => s.setAgentFilter)

  const agents = useMemo(() => {
    const map = new Map<string, string>()
    for (const entry of allHistory) {
      if (!map.has(entry.agentId)) map.set(entry.agentId, entry.displayName)
    }
    for (const [agentId, item] of Object.entries(allCurrent)) {
      if (!map.has(agentId)) map.set(agentId, item.displayName)
    }
    return Array.from(map.entries()).map(([agentId, displayName]) => ({ agentId, displayName }))
  }, [allHistory, allCurrent])

  // 只有一位选手时过滤无意义，保持面板紧凑。
  if (agents.length < 2) return null

  return (
    <div
      className="thin-scrollbar flex shrink-0 items-center gap-1.5 overflow-x-auto pb-0.5"
      data-testid="thinking-agent-filter"
      role="group"
      aria-label="按选手过滤思考链"
    >
      {[{ agentId: null, displayName: '全部' }, ...agents].map((option) => {
        const selected = agentFilter === option.agentId
        return (
          <button
            key={option.agentId ?? '__all__'}
            type="button"
            onClick={() => setAgentFilter(option.agentId)}
            aria-pressed={selected}
            className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition ${
              selected
                ? 'border-cyan-300/50 bg-cyan-300/15 text-cyan-100'
                : 'border-white/10 bg-slate-900/60 text-muted-foreground hover:border-cyan-300/30 hover:text-slate-200'
            }`}
          >
            {option.displayName}
          </button>
        )
      })}
    </div>
  )
}
