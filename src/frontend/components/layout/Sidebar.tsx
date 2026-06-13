'use client'

import { Activity, Bot, KeyRound, Radio } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { PendingLink } from '@/frontend/components/navigation/PendingLink'
import { cn } from '@/platform/utils'

const NAV = [
  { href: '/', label: '大厅', icon: Activity },
  { href: '/agents', label: 'Agents', icon: Bot },
  { href: '/profiles', label: 'API Profiles', icon: KeyRound },
]

export function Sidebar() {
  const pathname = usePathname()
  const [optimisticPath, setOptimisticPath] = useState(pathname)

  useEffect(() => {
    setOptimisticPath(pathname)
  }, [pathname])

  const collapsed = typeof optimisticPath === 'string' && optimisticPath.startsWith('/matches/')

  return (
    <aside
      className={cn(
        'sticky top-0 hidden h-screen shrink-0 border-r border-white/10 bg-[#080d14]/90 backdrop-blur-xl md:flex md:flex-col',
        collapsed ? 'w-14 px-2 py-3' : 'w-64 px-4 py-5',
      )}
    >
      {collapsed ? (
        <div className="mb-4 flex justify-center">
          <span
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-cyan-300/20 bg-cyan-300/10 text-cyan-200"
            title="Colosseum"
          >
            <Radio size={16} />
          </span>
        </div>
      ) : (
        <div className="mb-8 rounded-lg border border-white/10 bg-white/[0.03] p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-muted-foreground">Arena OS</div>
            <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-cyan-300/20 bg-cyan-300/10 text-cyan-200">
              <Radio size={14} />
            </span>
          </div>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white">Colosseum</h1>
          <div className="mt-3 h-px bg-gradient-to-r from-cyan-300/40 via-white/10 to-transparent" />
        </div>
      )}

      <nav className={cn('flex flex-col', collapsed ? 'gap-2' : 'gap-1')}>
        {NAV.map((item) => {
          const Icon = item.icon
          const active =
            item.href === '/'
              ? optimisticPath === '/'
              : optimisticPath === item.href || optimisticPath.startsWith(`${item.href}/`)
          return (
            <PendingLink
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              title={item.label}
              onClick={() => setOptimisticPath(item.href)}
              className={cn(
                'group relative flex items-center rounded-lg border transition-[background,border-color,box-shadow,transform] duration-100 ease-out active:translate-x-0.5',
                collapsed
                  ? 'h-9 w-9 items-center justify-center px-0 py-0'
                  : 'gap-3 px-3 py-2.5',
                active
                  ? 'border-cyan-300/25 bg-cyan-300/[0.08] text-cyan-50 shadow-[0_0_28px_rgba(34,211,238,0.08)]'
                  : 'border-transparent text-slate-300 hover:border-white/10 hover:bg-white/[0.04]',
                'data-[pending=true]:border-cyan-200/40 data-[pending=true]:bg-cyan-200/[0.09]',
              )}
            >
              <span
                className={cn(
                  'absolute left-0 top-1/2 h-6 w-0.5 -translate-y-1/2 rounded-r-full transition-opacity',
                  active ? 'bg-cyan-200 opacity-100' : 'opacity-0',
                )}
              />
              <Icon
                size={collapsed ? 18 : 17}
                className={cn('shrink-0 transition-colors', active ? 'text-cyan-200' : 'text-muted-foreground group-hover:text-slate-200')}
              />
              {!collapsed && (
                <div className="min-w-0">
                  <div className={cn('text-sm font-medium', active ? 'text-cyan-50' : 'text-slate-100')}>{item.label}</div>
                </div>
              )}
              <span className={cn('ml-auto h-1.5 w-1.5 rounded-full bg-cyan-200 opacity-0 transition-opacity group-data-[pending=true]:opacity-100', collapsed && 'hidden')} />
            </PendingLink>
          )
        })}
      </nav>

      <div className={cn('mt-auto rounded-lg border border-white/10 bg-white/[0.035] text-xs text-muted-foreground', collapsed ? 'p-2' : 'p-3')}>
        {collapsed ? (
          <div className="flex justify-center" title="LLM Agent 自主博弈竞技场">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/10 text-[10px] font-medium text-emerald-300">C</span>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium text-slate-200">Colosseum</span>
              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">LIVE</span>
            </div>
            <div className="mt-2 leading-5 text-muted-foreground">
              让多个 LLM Agent 在牌桌上自主博弈。创建对局、配置 Profile、实时观战、赛后复盘。
            </div>
          </>
        )}
      </div>
    </aside>
  )
}
