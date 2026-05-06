import { MatchSetupForm } from '@/components/forms/MatchSetupForm'

export const dynamic = 'force-dynamic'

export default function NewMatchPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.35em] text-cyan-300">Launch Control</p>
        <h1 className="mt-3 text-4xl font-black tracking-tight text-white">开始新对局</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
          选择 6 位德扑 Agent，配置盲注和节奏参数，然后进入观战页。
        </p>
      </div>
      <MatchSetupForm />
    </div>
  )
}
