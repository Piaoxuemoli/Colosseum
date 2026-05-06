import Link from 'next/link'

const NAV = [
  { href: '/', label: '大厅', hint: 'Live matches' },
  { href: '/matches/new', label: '新对局', hint: 'Launch table' },
  { href: '/agents', label: 'Agents', hint: 'Player roster' },
  { href: '/profiles', label: 'API Profiles', hint: 'Local keyring' },
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
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="group rounded-2xl border border-transparent px-3 py-3 transition hover:border-cyan-300/20 hover:bg-cyan-300/10"
          >
            <div className="text-sm font-semibold text-slate-100 group-hover:text-cyan-100">{item.label}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">{item.hint}</div>
          </Link>
        ))}
      </nav>

      <div className="mt-auto rounded-2xl border border-cyan-300/15 bg-cyan-300/10 p-3 text-xs text-cyan-100">
        <div className="font-semibold">Phase 1B</div>
        <div className="mt-1 text-cyan-100/70">API + playable setup flow</div>
      </div>
    </aside>
  )
}
