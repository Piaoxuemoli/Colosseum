export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8 flex items-end justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="h-3 w-36 animate-pulse rounded bg-cyan-200/20" />
          <div className="mt-4 h-9 w-56 animate-pulse rounded-lg bg-white/10" />
          <div className="mt-4 h-4 w-full max-w-xl animate-pulse rounded bg-white/8" />
        </div>
        <div className="hidden h-10 w-36 animate-pulse rounded-full bg-cyan-200/15 md:block" />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {['a', 'b', 'c'].map((key) => (
          <div key={key} className="h-28 animate-pulse rounded-lg border border-white/10 bg-white/[0.035]" />
        ))}
      </div>

      <div className="mt-10 grid gap-4 lg:grid-cols-2">
        {['d', 'e', 'f', 'g'].map((key) => (
          <div key={key} className="h-32 animate-pulse rounded-lg border border-white/10 bg-slate-950/45" />
        ))}
      </div>
    </div>
  )
}
