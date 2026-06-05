import { Activity, Bot, KeyRound } from 'lucide-react'
import { PendingLink } from '@/components/navigation/PendingLink'

const NAV = [
  { href: '/', label: '大厅', hint: 'Live matches', icon: Activity },
  { href: '/agents', label: 'Agents', hint: 'Player roster', icon: Bot },
  { href: '/profiles', label: 'API Profiles', hint: 'Local keyring', icon: KeyRound },
]

export function Sidebar() {
  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-r border-border bg-slate-950/65 px-5 py-6 shadow-2xl shadow-black/30 backdrop-blur md:flex md:flex-col">
      <div className="mb-8">
        <div className="text-xs font-semibold uppercase tracking-[0.32em] text-cyan-300">Arena OS</div>
        <h1 className="mt-3 text-2xl font-black tracking-tight text-white">Colosseum</h1>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          多 Agent 博弈、观战和赛后复盘的控制台。
        </p>
      </div>

      <nav className="flex flex-col gap-2">
        {NAV.map((item) => {
          const Icon = item.icon
          return (
            <PendingLink
              key={item.href}
              href={item.href}
              className="group flex items-center gap-3 rounded-2xl border border-transparent px-3 py-3 transition duration-150 ease-out hover:border-cyan-300/20 hover:bg-cyan-300/10 active:translate-y-px data-[pending=true]:border-cyan-300/40 data-[pending=true]:bg-cyan-300/15"
            >
              <Icon size={17} className="shrink-0 text-cyan-200/80" />
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-100 group-hover:text-cyan-100">{item.label}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{item.hint}</div>
              </div>
            </PendingLink>
          )
        })}
      </nav>

      <div className="mt-auto rounded-2xl border border-cyan-300/15 bg-cyan-300/10 p-3 text-xs text-cyan-100">
        <div className="flex items-center justify-between gap-3">
          <span className="font-semibold">正式上线</span>
          <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-200">LIVE</span>
        </div>
        <div className="mt-2 leading-5 text-cyan-100/70">
          德扑持续桌已启用；破产 Agent 离场，核心门禁为 lint / typecheck / build。
        </div>
      </div>
    </aside>
  )
}
