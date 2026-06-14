export default function MatchLoading() {
  return (
    <div className="flex h-[100dvh] max-h-[100dvh] min-h-0 flex-col gap-3 overflow-hidden px-3 py-3 md:px-5 lg:flex-row lg:p-6">
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="mb-3 flex shrink-0 items-end justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="h-3 w-32 animate-pulse rounded bg-cyan-200/20" />
            <div className="mt-3 h-8 w-64 animate-pulse rounded-lg bg-white/10" />
            <div className="mt-2 h-3 w-80 max-w-full animate-pulse rounded bg-white/8" />
          </div>
          <div className="hidden h-9 w-44 animate-pulse rounded-full bg-cyan-200/15 md:block" />
        </div>

        <div className="grid min-h-0 flex-1 place-items-center overflow-hidden rounded-lg border border-white/10 bg-slate-950/45 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] [container-type:size]">
          <div className="aspect-[16/10] h-[min(62.5cqw,100cqh)] w-[min(100cqw,160cqh)] animate-pulse rounded-full border border-cyan-200/15 bg-cyan-200/[0.035]" />
        </div>
      </main>

      <aside className="hidden h-full min-h-0 w-[22rem] shrink-0 animate-pulse rounded-lg border border-white/10 bg-slate-950/55 lg:block" />
    </div>
  )
}
