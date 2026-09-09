'use client'

import { Eye } from 'lucide-react'
import type { AvalonV2Accumulator } from '@/frontend/store/projections/avalon-v2'
import { AVALON_INSIGHT_ZH, avalonRoleZh } from './avalon-format'

/**
 * 知识面板（avalon-frontend PRD §2.7，AF-OD-2 v1 简版）：上帝视角专属，
 * 终局前按夜间知识矩阵（AVR-203）静态连线「谁看见谁」——观众借此理解
 * Agent 推理的信息基础。派西维尔的指向混排并列、不标注真伪（AVR-502）。
 * 纯 props 组件；视角开关（仅 god 渲染）由 AvalonSituationPanel 控制。
 */
export function AvalonKnowledgePanelView({
  acc,
  nameOf,
}: {
  acc: AvalonV2Accumulator
  nameOf: (agentId: string) => string
}) {
  return (
    <section
      data-testid="avalon-knowledge-panel"
      className="shrink-0 rounded-lg border border-violet-400/25 bg-violet-500/[0.05] p-3"
      aria-label="夜间知识矩阵"
    >
      <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-200">
        <Eye size={11} aria-hidden="true" />
        知识面板 · 上帝视角（AVR-203 知识矩阵）
      </div>
      {acc.knowledge.length === 0 ? (
        <p className="text-xs text-muted-foreground">尚无夜间情报事件。</p>
      ) : (
        <ul className="space-y-1.5">
          {acc.knowledge.map((entry, index) => {
            const knowerRole = acc.roles[entry.playerId]
            const isPercivalMix = entry.insight === 'percival'
            return (
              <li
                key={`${entry.playerId}-${index}`}
                className="rounded-md border border-white/10 bg-slate-950/60 px-2.5 py-1.5"
                data-testid={`avalon-knowledge-${entry.playerId}`}
              >
                <div className="flex flex-wrap items-center gap-1 text-xs">
                  <span className="font-semibold text-slate-100">
                    {nameOf(entry.playerId)}
                    {knowerRole ? <span className="ml-1 text-[10px] text-violet-200/80">（{avalonRoleZh(knowerRole)}）</span> : null}
                  </span>
                  <span className="text-muted-foreground" aria-hidden="true">
                    →
                  </span>
                  <span className="text-violet-100/90">{AVALON_INSIGHT_ZH[entry.insight]}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  {entry.playerIds.length > 0 ? (
                    entry.playerIds.map((targetId) => (
                      <span
                        key={targetId}
                        className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] ${
                          isPercivalMix
                            ? 'border-amber-300/40 bg-amber-500/10 text-amber-100'
                            : 'border-rose-300/30 bg-rose-500/10 text-rose-100'
                        }`}
                      >
                        {nameOf(targetId)}
                        {!isPercivalMix && acc.roles[targetId] ? (
                          <span className="font-mono text-[9px] opacity-70">{avalonRoleZh(acc.roles[targetId])}</span>
                        ) : null}
                      </span>
                    ))
                  ) : (
                    <span className="text-[10px] text-muted-foreground">无情报指向</span>
                  )}
                  {isPercivalMix ? (
                    <span className="text-[9px] text-amber-200/70">（混排并列，不标注真伪）</span>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
