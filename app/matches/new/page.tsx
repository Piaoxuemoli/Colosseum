import { NewMatchTabs } from '@/components/forms/NewMatchTabs'

export const dynamic = 'force-dynamic'

export default function NewMatchPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.35em] text-cyan-300">Launch Control</p>
        <h1 className="mt-3 text-4xl font-black tracking-tight text-white">开始新对局</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
          选择游戏类型、参赛 Agent 和对局参数,一键开局。
        </p>
      </div>
      <NewMatchTabs />
    </div>
  )
}
