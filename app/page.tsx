export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-16">
      <section className="w-full max-w-3xl rounded-3xl border border-cyan-300/20 bg-slate-950/70 p-10 shadow-2xl shadow-cyan-950/30 backdrop-blur">
        <p className="text-sm font-medium uppercase tracking-[0.35em] text-cyan-300">
          LLM Agent Arena
        </p>
        <h1 className="mt-5 text-5xl font-semibold tracking-tight text-white">
          Colosseum
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-300">
          Phase 0 骨架已启动。这里将成为多 Agent 自主博弈、实时观战和赛后复盘的竞技场控制台。
        </p>
      </section>
    </main>
  )
}
