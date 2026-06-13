'use client'

import { Activity, Bot, KeyRound, Radio } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { PendingLink } from '@/frontend/components/navigation/PendingLink'
import { cn } from '@/platform/utils'

const NAV = [
  { href: '/', label: '大厅', hint: 'Live matches', icon: Activity },
  { href: '/agents', label: 'Agents', hint: 'Player roster', icon: Bot },
  { href: '/profiles', label: 'API Profiles', hint: 'Local keyring', icon: KeyRound },
]

export function Sidebar() {
  const pathname = usePathname()
  const [optimisticPath, setOptimisticPath] = useState(pathname)

  useEffect(() => {
    setOptimisticPath(pathname)
  }, [pathname])

  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-r border-white/10 bg-[#080d14]/90 px-4 py-5 shadow-[inset_-1px_0_0_rgba(255,255,255,0.04)] backdrop-blur-xl md:flex md:flex-col">
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

      <nav className="flex flex-col gap-1">
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
              onClick={() => setOptimisticPath(item.href)}
              className={cn(
                'group relative flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-[background,border-color,box-shadow,transform] duration-100 ease-out active:translate-x-0.5',
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
                size={17}
                className={cn('shrink-0 transition-colors', active ? 'text-cyan-200' : 'text-muted-foreground group-hover:text-slate-200')}
              />
              <div className="min-w-0">
                <div className={cn('text-sm font-medium', active ? 'text-cyan-50' : 'text-slate-100')}>{item.label}</div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">{item.hint}</div>
              </div>
              <span className="ml-auto h-1.5 w-1.5 rounded-full bg-cyan-200 opacity-0 transition-opacity group-data-[pending=true]:opacity-100" />
            </PendingLink>
          )
        })}
      </nav>

      <div className="mt-auto rounded-lg border border-white/10 bg-white/[0.035] p-3 text-xs text-muted-foreground">
        <div className="flex items-center justify-between gap-3">
          <span className="font-medium text-slate-200">正式上线</span>
          <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">LIVE</span>
        </div>
        <div className="mt-2 leading-5 text-muted-foreground">
          德扑持续桌已启用；破产 Agent 离场，核心门禁为 lint / typecheck / build。
        </div>
      </div>
    </aside>
  )
}
