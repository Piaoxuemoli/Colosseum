'use client'

import { AlertTriangle, CircleCheck, CircleX, Swords } from 'lucide-react'
import type { AvalonQuestSlot } from '@/frontend/store/projections/avalon-v2'

/**
 * 任务板（avalon-frontend PRD §2.1，态势核心 P0）：
 * 5 轮任务槽横排（任务人数 + 双失败轮标记 + 当前轮高亮 + 结果态与失败张数）、
 * 赛点条（好人成功 vs 坏人失败，3:3 制）、连坐计数与「再拒一次坏人直接胜」警示。
 * 全部数据来自公共事件——任何视角可见（不含私有信息）。纯 props 组件。
 */

const SLOT_STATUS_STYLE: Record<AvalonQuestSlot['status'], string> = {
  success: 'border-sky-400/50 bg-sky-500/10',
  fail: 'border-rose-400/50 bg-rose-500/10',
  ongoing: 'border-cyan-300/60 bg-cyan-300/10 animate-pulse',
  pending: 'border-white/10 bg-slate-950/60',
}

export function AvalonQuestBoardView({
  quests,
  successes,
  fails,
  round,
  attempt,
  rejectionCount,
  ended,
}: {
  quests: AvalonQuestSlot[]
  successes: number
  fails: number
  round: number
  attempt: number
  rejectionCount: number
  ended: boolean
}) {
  const goodPct = Math.min(100, (successes / 3) * 100)
  const evilPct = Math.min(100, (fails / 3) * 100)
  // AVR-403：第 5 次提案被拒 → 坏人直接胜。第 4 次拒绝后进入赛点警示。
  const rejectionWarning = !ended && rejectionCount >= 4

  return (
    <section
      data-testid="avalon-quest-board"
      className="shrink-0 rounded-lg border border-white/10 bg-slate-950/45 p-3"
      aria-label="任务板"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">任务板 · 5 轮 3 胜制</div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span data-testid="avalon-match-point">
            好人 <span className="font-mono font-semibold text-sky-200">{successes}</span> :{' '}
            <span className="font-mono font-semibold text-rose-200">{fails}</span> 坏人
          </span>
          <span className="text-white/20">|</span>
          <span data-testid="avalon-attempt-counter">
            第 {round > 0 ? round : '—'} 轮 · 第 {attempt > 0 ? attempt : '—'} 次提案（连坐 {rejectionCount}/5）
          </span>
        </div>
      </div>

      {/* 赛点条：好人成功数 vs 坏人失败数（3:3）。 */}
      <div className="mt-2 flex items-center gap-2" aria-label="赛点条">
        <span className="text-[10px] text-sky-200">好人 3 胜</span>
        <div className="h-1.5 flex-1 overflow-hidden rounded bg-white/5">
          <div className="h-full bg-sky-400/80 transition-all" style={{ width: `${goodPct}%` }} />
        </div>
        <span className="font-mono text-[10px] text-muted-foreground">3:3</span>
        <div className="h-1.5 flex-1 overflow-hidden rounded bg-white/5">
          <div className="ml-auto h-full bg-rose-400/80 transition-all" style={{ width: `${evilPct}%` }} />
        </div>
        <span className="text-[10px] text-rose-200">坏人 3 败</span>
      </div>

      {/* 5 轮任务槽横排。 */}
      <ol className="mt-3 grid grid-cols-5 gap-1.5" aria-label="任务轮次">
        {quests.map((quest) => {
          const isCurrent = !ended && quest.round === round && (quest.status === 'ongoing' || (quest.status === 'pending' && round === quest.round))
          return (
            <li
              key={quest.round}
              data-testid={`avalon-quest-slot-${quest.round}`}
              data-status={quest.status}
              className={`rounded-md border p-2 text-center ${SLOT_STATUS_STYLE[quest.status]} ${
                isCurrent ? 'ring-1 ring-cyan-300/50' : ''
              }`}
            >
              <div className="flex items-center justify-center gap-1">
                <span className="font-mono text-[10px] text-muted-foreground">R{quest.round}</span>
                {quest.requiredFails >= 2 ? (
                  <span
                    className="inline-flex items-center gap-0.5 rounded border border-amber-400/40 bg-amber-500/10 px-1 text-[9px] font-semibold text-amber-200"
                    title={`双失败轮：需要 ${quest.requiredFails} 张失败牌才判失败`}
                    aria-label="双失败轮"
                  >
                    <Swords size={9} aria-hidden="true" />×2
                  </span>
                ) : null}
              </div>
              <div className="mt-1 font-mono text-sm font-semibold text-slate-100">{quest.teamSize} 人</div>
              <div className="mt-1 flex items-center justify-center gap-1">
                {quest.status === 'success' ? (
                  <CircleCheck size={14} className="text-sky-300" aria-label="任务成功" />
                ) : quest.status === 'fail' ? (
                  <CircleX size={14} className="text-rose-300" aria-label="任务失败" />
                ) : (
                  <span className="text-[10px] text-muted-foreground">
                    {quest.status === 'ongoing' ? '进行中' : '未开始'}
                  </span>
                )}
              </div>
              {quest.status === 'fail' && quest.failVotes !== null ? (
                <div className="mt-0.5 font-mono text-[9px] text-rose-200/90">{quest.failVotes} 张失败牌</div>
              ) : null}
            </li>
          )
        })}
      </ol>

      {rejectionWarning ? (
        <div
          data-testid="avalon-rejection-warning"
          className="mt-2 flex items-center justify-center gap-1.5 rounded-md border border-amber-400/40 bg-amber-500/10 px-2 py-1.5 text-xs font-semibold text-amber-100"
          role="alert"
        >
          <AlertTriangle size={13} aria-hidden="true" />
          再拒一次坏人直接获胜（第 5 次提案被拒即连坐判负）
        </div>
      ) : null}
    </section>
  )
}
