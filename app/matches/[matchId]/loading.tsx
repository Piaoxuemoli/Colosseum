export default function MatchLoading() {
  return (
    <div className="flex flex-col gap-4 px-4 py-8 md:px-8 lg:flex-row">
      <main className="min-w-0 flex-1">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="h-3 w-32 animate-pulse rounded bg-cyan-200/20" />
            <div className="mt-4 h-9 w-64 animate-pulse rounded-lg bg-white/10" />
            <div className="mt-3 h-3 w-80 max-w-full animate-pulse rounded bg-white/8" />
          </div>
          <div className="hidden h-9 w-44 animate-pulse rounded-full bg-cyan-200/15 md:block" />
        </div>

        <div className="grid min-h-[34rem] place-items-center rounded-lg border border-white/10 bg-slate-950/45 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
          <div className="h-72 w-full max-w-3xl animate-pulse rounded-full border border-cyan-200/15 bg-cyan-200/[0.035]" />
        </div>
      </main>

      <aside className="hidden h-[calc(100vh-4rem)] w-[22rem] shrink-0 animate-pulse rounded-lg border border-white/10 bg-slate-950/55 lg:block" />
    </div>
  )
}
