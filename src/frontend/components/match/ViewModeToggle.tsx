'use client'

import { Eye, EyeOff } from 'lucide-react'
import { useMatchViewStore } from '@/frontend/store/match-view-store'

/**
 * 观战视角切换（engine2-integration spec §6 / PK-1）：
 * - 上帝视角（默认，两游戏一致）：全量信息；
 * - 公开视角：按受众剥离载荷——底牌回牌背（该手结算后揭示）、夜间动作
 *   隐藏、身份在终局揭示前隐藏。切换基于已存事件流重投影，不重新拉取。
 *
 * v1 对局事件本就是公开快照，公开视角与上帝视角等价；该开关只对 v2 对局
 * 产生信息差。
 */
export function ViewModeToggle() {
  const viewMode = useMatchViewStore((s) => s.viewMode)
  const setViewMode = useMatchViewStore((s) => s.setViewMode)

  const options = [
    { value: 'god' as const, label: '上帝视角', icon: Eye },
    { value: 'public' as const, label: '公开视角', icon: EyeOff },
  ]

  return (
    <div
      role="group"
      aria-label="观战视角"
      data-testid="view-mode-toggle"
      data-active={viewMode}
      className="flex items-center gap-0.5 rounded-lg border border-white/15 bg-slate-950/60 p-0.5"
    >
      {options.map((option) => {
        const active = viewMode === option.value
        const Icon = option.icon
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => setViewMode(option.value)}
            className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
              active
                ? 'bg-white/12 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'
                : 'text-muted-foreground hover:text-slate-200'
            }`}
          >
            <Icon size={12} aria-hidden="true" />
            <span>{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}
