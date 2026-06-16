'use client'

import { useMatchViewStore } from '@/frontend/store/match-view-store'

const PHASE_ZH: Record<string, string> = {
  'night/werewolfDiscussion': '夜晚 · 狼人商议',
  'night/werewolfKill': '夜晚 · 狼人行动',
  'night/seerCheck': '夜晚 · 预言家查验',
  'night/witchAction': '夜晚 · 女巫抉择',
  'day/announce': '天亮 · 公告',
  'day/speak': '白日 · 依次发言',
  'day/vote': '白日 · 全员投票',
  'day/execute': '白日 · 公示出局',
}

const WINNER_ZH: Record<string, string> = {
  werewolves: '🐺 狼人阵营胜利',
  villagers: '🏠 好人阵营胜利',
  tie: '⚖️ 平局',
}

/** 狼人杀右侧「状态」tab：阶段/天数/存活/当前行动者/胜负。不泄露未揭示身份。 */
export function WerewolfStatusPanel() {
  const ww = useMatchViewStore((s) => s.werewolf)
  const players = useMatchViewStore((s) => s.players)
  const deaths = useMatchViewStore((s) => s.werewolf.deaths)
  const currentActor = useMatchViewStore((s) => s.currentActor)

  const aliveCount = Math.max(0, players.length - deaths.length)
  const actorName = currentActor
    ? players.find((p) => p.agentId === currentActor)?.displayName ?? currentActor
    : null

  const stats: Array<{ label: string; value: string; accent?: boolean }> = [
    { label: '当前阶段', value: (ww.phase ? PHASE_ZH[ww.phase] ?? ww.phase : '等待开局'), accent: true },
    { label: '游戏天数', value: `Day ${ww.day}` },
    { label: '存活人数', value: `${aliveCount} / ${players.length}` },
    { label: '累计出局', value: `${deaths.length}` },
  ]

  return (
    <div className="h-full min-h-0 space-y-3 overflow-y-auto thin-scrollbar" data-testid="werewolf-status-panel">
      <div className="grid grid-cols-2 gap-2">
        {stats.map((s) => (
          <div
            key={s.label}
            className={`rounded-lg border p-2.5 ${
              s.accent
                ? 'border-cyan-300/30 bg-cyan-300/5'
                : 'border-white/10 bg-slate-950/45'
            }`}
          >
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{s.label}</div>
            <div className={`mt-1 truncate text-sm font-semibold ${s.accent ? 'text-cyan-100' : 'text-slate-100'}`}>
              {s.value}
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-white/10 bg-slate-950/45 p-2.5">
        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">当前行动者</div>
        <div className="mt-1 truncate text-sm font-semibold text-emerald-200">
          {actorName ?? (ww.winner ? '—' : '等待中')}
        </div>
      </div>

      {ww.winner ? (
        <div className="rounded-lg border border-amber-400/40 bg-amber-500/10 p-3 text-center text-base font-bold text-amber-100">
          {WINNER_ZH[ww.winner] ?? ww.winner}
        </div>
      ) : null}
    </div>
  )
}
