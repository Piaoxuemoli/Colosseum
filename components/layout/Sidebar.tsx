import { Activity, Bot, KeyRound } from 'lucide-react'
import { PendingLink } from '@/components/navigation/PendingLink'

const NAV = [
  { href: '/', label: '大厅', hint: 'Live matches', icon: Activity },
  { href: '/agents', label: 'Agents', hint: 'Player roster', icon: Bot },
  { href: '/profiles', label: 'API Profiles', hint: 'Local keyring', icon: KeyRound },
]

export function Sidebar() {
  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-r border-border bg-slate-950/65 px-5 py-6 backdrop-blur md:flex md:flex-col">
      <div className="mb-10">
        <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-muted-foreground">Arena OS</div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white">Colosseum</h1>
      </div>

      <nav className="flex flex-col gap-1">
        {NAV.map((item) => {
          const Icon = item.icon
          return (
            <PendingLink
              key={item.href}
              href={item.href}
              className="group flex items-center gap-3 rounded-xl border border-transparent px-3 py-2.5 transition duration-150 ease-out hover:border-border hover:bg-slate-900/50 active:scale-[0.98] data-[pending=true]:border-border data-[pending=true]:bg-slate-900/60"
            >
              <Icon size={17} className="shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <div className="text-sm font-medium text-slate-100">{item.label}</div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">{item.hint}</div>
              </div>
            </PendingLink>
          )
        })}
      </nav>

      <div className="mt-auto rounded-2xl border border-border bg-slate-900/40 p-3 text-xs text-muted-foreground">
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
