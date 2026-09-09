'use client'

import { useMemo } from 'react'
import { Crown, EyeOff, LoaderCircle, Lock, Target } from 'lucide-react'
import type { PokerUiPlayer } from '@/frontend/store/match-view-store'
import { useMatchViewStore } from '@/frontend/store/match-view-store'
import {
  avalonCurrentTeamOf,
  avalonGoodAtMatchPoint,
  avalonPerspectiveOf,
  avalonRejectionCountOf,
  avalonScoreOf,
  deriveAvalonView,
  type AvalonV2Accumulator,
  type AvalonView,
} from '@/frontend/store/projections/avalon-v2'
import { useThinkingStore } from '@/frontend/store/thinking-store'
import { avalonPhaseZh, avalonRoleZh } from './avalon-format'
import { AvalonKnowledgePanelView } from './AvalonKnowledgePanel'
import { buildAvalonSeatCards, AvalonSeatCardView } from './AvalonSeatCard'
import { AvalonQuestBoardView } from './AvalonQuestBoard'

/**
 * 阿瓦隆态势主面板（avalon-frontend PRD §2）：任务板 + 座位卡横排 + 阶段条 +
 * 发言流（含密谋遮蔽）+ 记名表决汇总 + 任务出牌进度 + 刺杀仪式 + 终局翻牌 +
 * 知识面板（god 视角）。store 连接层只做取数，呈现逻辑全在 AvalonSituationBody
 * （纯 props，单测可脱离 store 渲染）。
 */
export function AvalonSituationPanel({ matchId, players }: { matchId: string; players: PokerUiPlayer[] }) {
  const acc = useMatchViewStore((state) => state.avalonV2)
  const viewMode = useMatchViewStore((state) => state.viewMode)
  const focusPlayerId = useMatchViewStore((state) => state.avalonFocusPlayerId)
  const currentThinking = useThinkingStore((state) => state.current)

  const perspective = avalonPerspectiveOf(viewMode, focusPlayerId)
  const view = useMemo(() => deriveAvalonView(acc, perspective, focusPlayerId), [acc, perspective, focusPlayerId])
  const thinkingAgentIds = useMemo(() => new Set(Object.keys(currentThinking)), [currentThinking])

  return <AvalonSituationBody acc={acc} view={view} players={players} thinkingAgentIds={thinkingAgentIds} matchId={matchId} />
}

export function AvalonSituationBody({
  acc,
  view,
  players,
  thinkingAgentIds,
  matchId,
}: {
  acc: AvalonV2Accumulator
  view: AvalonView
  players: PokerUiPlayer[]
  thinkingAgentIds: ReadonlySet<string>
  matchId: string
}) {
  const nameOf = (agentId: string) => players.find((player) => player.agentId === agentId)?.displayName ?? agentId
  const { successes, fails } = avalonScoreOf(acc)
  const rejectionCount = avalonRejectionCountOf(acc)
  const seatCards = buildAvalonSeatCards(acc, view, players, thinkingAgentIds)
  const goodAtMatchPoint = avalonGoodAtMatchPoint(acc)
  const ceremonyActive = goodAtMatchPoint || acc.phase === 'evilConsultation' || acc.phase === 'assassination'

  const seatCols =
    seatCards.length <= 5 ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6'

  return (
    <div
      className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto thin-scrollbar"
      data-testid="avalon-situation"
      aria-label={`阿瓦隆观战面板 ${matchId}`}
    >
      {/* 当前阶段条（PRD §2.3 阶段氛围的轻量形态）。 */}
      <section
        data-testid="avalon-phase-strip"
        className="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-slate-950/45 px-3 py-2"
      >
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">阶段</span>
          <span
            data-testid="avalon-phase-label"
            className={`rounded border px-2 py-0.5 text-xs font-semibold ${
              acc.phase === 'evilConsultation' || acc.phase === 'assassination'
                ? 'border-rose-400/50 bg-rose-500/10 text-rose-200'
                : acc.phase === 'quest'
                  ? 'border-cyan-300/40 bg-cyan-300/10 text-cyan-100'
                  : 'border-white/15 bg-white/5 text-slate-100'
            }`}
          >
            {avalonPhaseZh(acc.phase)}
          </span>
          {acc.boardName ? <span className="text-xs text-muted-foreground">{acc.boardName}</span> : null}
          {acc.leaderId && acc.phase !== 'ended' ? (
            <span className="inline-flex items-center gap-1 text-xs text-amber-200">
              <Crown size={12} aria-hidden="true" />
              队长 {nameOf(acc.leaderId)}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="avalon-pending-actors">
          <LoaderCircle size={12} aria-hidden="true" className={view.pendingActors.length > 0 ? 'animate-spin text-cyan-200' : ''} />
          {view.pendingActors.length > 0
            ? `等待行动：${view.pendingActors.map(nameOf).join('、')}`
            : view.revealed
              ? '对局已结束'
              : '—'}
        </div>
      </section>

      {/* 任务板（P0 态势核心）。 */}
      <AvalonQuestBoardView
        quests={acc.quests}
        successes={successes}
        fails={fails}
        round={acc.round}
        attempt={acc.attempt}
        rejectionCount={rejectionCount}
        ended={acc.ended !== null}
      />

      {/* 座位卡横排（AF-OD-1）。 */}
      <section data-testid="avalon-seat-row" aria-label="玩家座位" className={`grid shrink-0 gap-2 ${seatCols}`}>
        {seatCards.map((card) => (
          <AvalonSeatCardView key={card.playerId} card={card} />
        ))}
        {seatCards.length === 0 ? <p className="text-xs text-muted-foreground">等待开局名册…</p> : null}
      </section>

      {/* 主区：发言流（左） + 表决/知识/刺杀/终局（右）。 */}
      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <AvalonStatementStream acc={acc} view={view} nameOf={nameOf} />

        <div className="flex min-h-0 flex-col gap-3">
          <AvalonVotePanel acc={acc} view={view} nameOf={nameOf} />
          {view.perspective === 'god' && !view.revealed && acc.knowledge.length > 0 ? (
            <AvalonKnowledgePanelView acc={acc} nameOf={nameOf} />
          ) : null}
          {ceremonyActive || acc.assassination ? <AvalonAssassinationPanel acc={acc} nameOf={nameOf} /> : null}
          {view.revealed && acc.ended ? <AvalonEndPanel acc={acc} nameOf={nameOf} /> : null}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 发言 / 讨论呈现（PRD §2.4）：讨论发言全文 + 密谋容器的视角遮蔽
// ---------------------------------------------------------------------------

function AvalonStatementStream({
  acc,
  view,
  nameOf,
}: {
  acc: AvalonV2Accumulator
  view: AvalonView
  nameOf: (agentId: string) => string
}) {
  const visible = view.statements.filter((statement) => !statement.hidden)
  const hiddenConsultations = view.statements.filter((statement) => statement.hidden)
  const consultations = visible.filter((statement) => statement.kind === 'consultation')
  const discussions = visible.filter((statement) => statement.kind === 'discussion')
  const currentRound = acc.round

  return (
    <section
      data-testid="avalon-statement-stream"
      className="flex min-h-0 flex-col rounded-lg border border-white/10 bg-slate-950/45 p-3"
      aria-label="发言流"
    >
      <div className="mb-2 flex shrink-0 items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">发言 · 第 {currentRound > 0 ? currentRound : '—'} 轮</div>
        {!acc.discussionEnabled ? (
          <span className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-muted-foreground">
            本局未启用讨论阶段（直接提名）
          </span>
        ) : null}
      </div>

      <div className="thin-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {discussions.length === 0 && consultations.length === 0 && hiddenConsultations.length === 0 ? (
          <p className="text-xs text-muted-foreground">{acc.discussionEnabled ? '等待发言…' : '本局无讨论阶段。'}</p>
        ) : null}

        {/* 公开讨论：全文呈现（载荷透传，长文由容器滚动折叠）。 */}
        {discussions.map((statement, index) => (
          <article
            key={`discussion-${index}`}
            data-testid={`avalon-statement-${index}`}
            className="rounded-lg border border-white/10 bg-slate-900/50 px-3 py-2"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-100">{nameOf(statement.speakerId)}</span>
              <span className="font-mono text-[10px] text-muted-foreground">R{statement.round}</span>
            </div>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-200">{statement.text}</p>
            {statement.isDefault ? (
              <p className="mt-1 text-[10px] text-amber-300/80">（兜底默认动作：跳过发言）</p>
            ) : null}
          </article>
        ))}

        {/* 密谋容器：公开视角显示遮蔽占位（PRD §2.4）。 */}
        {hiddenConsultations.length > 0 ? (
          <div
            data-testid="avalon-consultation-masked"
            className="flex items-center justify-center gap-2 rounded-lg border border-rose-400/25 bg-rose-500/[0.06] px-3 py-3 text-sm text-rose-200/80"
            aria-live="off"
          >
            <EyeOff size={14} aria-hidden="true" />
            坏人正在密谋（不可见）
            <span className="font-mono text-[10px] text-rose-200/60">× {hiddenConsultations.length}</span>
          </div>
        ) : null}

        {/* 密谋容器：god / 坏人玩家视角可见全文。 */}
        {consultations.length > 0 ? (
          <div className="rounded-lg border border-rose-400/30 bg-rose-500/[0.06] p-2" data-testid="avalon-consultation-visible">
            <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-rose-200">
              <Lock size={10} aria-hidden="true" />
              坏人密谋 · 刺杀合议
            </div>
            <div className="space-y-1.5">
              {consultations.map((statement, index) => (
                <article key={`consultation-${index}`} className="rounded border border-rose-400/15 bg-slate-950/60 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-rose-100">{nameOf(statement.speakerId)}</span>
                    <span className="font-mono text-[10px] text-rose-200/50">R{statement.round}</span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-rose-50/90">{statement.text}</p>
                </article>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// 记名表决 + 任务出牌进度（PRD §2.5）
// ---------------------------------------------------------------------------

function AvalonVotePanel({
  acc,
  view,
  nameOf,
}: {
  acc: AvalonV2Accumulator
  view: AvalonView
  nameOf: (agentId: string) => string
}) {
  const latestProposal = acc.proposals[acc.proposals.length - 1] ?? null
  const votes = latestProposal
    ? acc.voteRecords.filter((record) => record.round === latestProposal.round && record.attempt === latestProposal.attempt)
    : []
  const tally = latestProposal
    ? [...acc.voteTallies].reverse().find((candidate) => candidate.round === latestProposal.round && candidate.attempt === latestProposal.attempt) ?? null
    : null

  const team = avalonCurrentTeamOf(acc)
  const played = acc.questChoices.filter((choice) => choice.round === acc.round).length
  const questOngoing = acc.phase === 'quest' && team.length > 0
  const latestQuest = [...acc.quests].reverse().find((quest) => quest.status === 'success' || quest.status === 'fail') ?? null

  const approvePct = tally && tally.approvals + tally.rejections > 0 ? (tally.approvals / (tally.approvals + tally.rejections)) * 100 : 0

  return (
    <section data-testid="avalon-vote-panel" className="shrink-0 rounded-lg border border-white/10 bg-slate-950/45 p-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">表决 · 任务</div>

      {latestProposal ? (
        <div className="rounded-md border border-white/10 bg-slate-900/50 px-2.5 py-2">
          <div className="flex flex-wrap items-center justify-between gap-1 text-xs">
            <span className="text-slate-200">
              第 {latestProposal.round} 轮 · 第 {latestProposal.attempt} 次提案
            </span>
            {tally ? (
              <span
                className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${
                  tally.outcome === 'approved'
                    ? 'border-emerald-400/50 bg-emerald-500/10 text-emerald-200'
                    : 'border-rose-400/50 bg-rose-500/10 text-rose-200'
                }`}
              >
                {tally.outcome === 'approved' ? '通过' : '被拒'}
              </span>
            ) : (
              <span className="text-[10px] text-muted-foreground">表决进行中</span>
            )}
          </div>
          <p className="mt-1 text-xs text-slate-300">
            队伍（{latestProposal.teamIds.length} 人）：{latestProposal.teamIds.map(nameOf).join('、')}
          </p>
          {/* 记名表决逐人角标（AVR-107 公开口径）。 */}
          <ul className="mt-2 flex flex-wrap gap-1" data-testid="avalon-vote-badges" aria-label="记名表决">
            {votes.map((record) => (
              <li
                key={`${record.voterId}`}
                className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold ${
                  record.approve
                    ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200'
                    : 'border-rose-400/40 bg-rose-500/10 text-rose-200'
                }`}
                title={`${nameOf(record.voterId)} ${record.approve ? '赞成' : '反对'}`}
              >
                {nameOf(record.voterId)} {record.approve ? '赞成' : '反对'}
              </li>
            ))}
          </ul>
          {tally ? (
            <div className="mt-2">
              <div className="flex h-1.5 overflow-hidden rounded bg-white/5" aria-label="表决汇总">
                <div className="h-full bg-emerald-400/80" style={{ width: `${approvePct}%` }} />
                <div className="h-full flex-1 bg-rose-400/60" />
              </div>
              <div className="mt-1 flex justify-between font-mono text-[10px] text-muted-foreground">
                <span className="text-emerald-200">赞成 {tally.approvals}</span>
                <span className="text-rose-200">反对 {tally.rejections}</span>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">尚无提案。</p>
      )}

      {/* 任务出牌进度（不露任何立场）+ 失败张数。 */}
      <div className="mt-2 rounded-md border border-white/10 bg-slate-900/50 px-2.5 py-2" data-testid="avalon-quest-progress">
        {questOngoing ? (
          <div className="flex items-center justify-between text-xs">
            <span className="text-cyan-100">任务执行中 · 出牌进度</span>
            <span className="font-mono text-slate-200" data-testid="avalon-quest-played">
              已出 {played} / 队伍 {team.length}
            </span>
          </div>
        ) : latestQuest ? (
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">最近任务结算（第 {latestQuest.round} 轮）</span>
            <span className={latestQuest.status === 'success' ? 'text-sky-200' : 'text-rose-200'}>
              {latestQuest.status === 'success' ? '成功' : `失败 · ${latestQuest.failVotes ?? 0} 张失败牌`}
            </span>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">任务尚未开始。</p>
        )}
        <p className="mt-1 text-[10px] text-muted-foreground">任务抉择保密：任何视角终局前不显示个体立场。</p>
      </div>

      {/* 单玩家视角：本人历史出牌（AVR-108 仅本人可见）。 */}
      {view.perspective === 'player' && view.ownQuestChoices.length > 0 ? (
        <div className="mt-2 rounded-md border border-cyan-300/25 bg-cyan-300/[0.06] px-2.5 py-2" data-testid="avalon-own-choices">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200">你的任务出牌（仅本人可见）</div>
          <ul className="mt-1 space-y-0.5 font-mono text-[10px] text-cyan-100/90">
            {view.ownQuestChoices.map((choice, index) => (
              <li key={index}>
                第 {choice.round} 轮 · {choice.succeed ? '成功牌' : '失败牌'}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}

// ---------------------------------------------------------------------------
// 刺杀仪式（PRD §2.6）：赛点横幅 → 密谋 → 指认 → 揭晓
// ---------------------------------------------------------------------------

function AvalonAssassinationPanel({ acc, nameOf }: { acc: AvalonV2Accumulator; nameOf: (agentId: string) => string }) {
  const goodAtMatchPoint = avalonGoodAtMatchPoint(acc)

  return (
    <section
      data-testid="avalon-assassination-panel"
      className="shrink-0 rounded-lg border border-rose-400/30 bg-rose-500/[0.05] p-3"
      aria-label="刺杀环节"
    >
      <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-rose-200">
        <Target size={11} aria-hidden="true" />
        刺杀环节
      </div>

      {goodAtMatchPoint ? (
        <div
          data-testid="avalon-match-point-banner"
          className="rounded-md border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-center text-sm font-bold text-amber-100"
          role="status"
        >
          好人达成 3 次任务成功——好人还未获胜！
        </div>
      ) : null}

      {acc.phase === 'evilConsultation' ? (
        <p className="mt-2 text-xs text-rose-100/80">坏人阵营正在密谋刺杀目标（发言见左侧密谋容器）…</p>
      ) : null}

      {acc.phase === 'assassination' && !acc.assassination ? (
        <p className="mt-2 text-xs text-rose-100/80">刺杀权持有者正在指认目标…（指认公开前不点名）</p>
      ) : null}

      {acc.assassination ? (
        <div className="mt-2 rounded-md border border-rose-400/40 bg-slate-950/70 px-3 py-2 text-sm" data-testid="avalon-assassination-declared">
          <span className="text-rose-200">刺客 {nameOf(acc.assassination.assassinId)}</span>
          <span className="mx-1 text-muted-foreground">→</span>
          <span className="font-semibold text-white">指认 {nameOf(acc.assassination.targetId)}</span>
          {acc.ended ? null : <p className="mt-1 text-[10px] text-amber-200/80">等待揭晓：指认梅林 = 坏人翻盘…</p>}
        </div>
      ) : null}
    </section>
  )
}

// ---------------------------------------------------------------------------
// 终局翻牌（PRD §2.6）：全员翻牌 + 胜方 + 依据
// ---------------------------------------------------------------------------

function AvalonEndPanel({ acc, nameOf }: { acc: AvalonV2Accumulator; nameOf: (agentId: string) => string }) {
  const ended = acc.ended
  if (!ended) return null
  const winnerStyle =
    ended.winner === 'good'
      ? 'border-sky-400/50 bg-sky-500/10 text-sky-100'
      : ended.winner === 'evil'
        ? 'border-rose-400/50 bg-rose-500/10 text-rose-100'
        : 'border-white/20 bg-white/5 text-slate-100'
  const winnerZh = ended.winner === 'good' ? '好人阵营胜利' : ended.winner === 'evil' ? '坏人阵营胜利' : '平局'

  return (
    <section
      data-testid="avalon-end-panel"
      className={`shrink-0 rounded-lg border p-3 ${winnerStyle}`}
      aria-label="终局揭示"
    >
      <div className="text-center text-lg font-black tracking-wide" data-testid="avalon-winner-banner">
        {winnerZh}
      </div>
      {ended.basis ? <p className="mt-1 text-center text-xs opacity-80">{ended.basis}</p> : null}
      <ul className="mt-2 space-y-1" data-testid="avalon-reveal-list">
        {[...ended.reveal]
          .sort((a, b) => a.seat - b.seat)
          .map((entry) => (
            <li key={entry.playerId} className="flex items-center gap-2 rounded bg-slate-950/50 px-2 py-1 text-xs">
              <span className="w-6 font-mono text-[10px] text-muted-foreground">#{entry.seat}</span>
              <span className="min-w-0 flex-1 truncate text-slate-100">{nameOf(entry.playerId)}</span>
              <span className="font-mono text-[10px] text-muted-foreground">{avalonRoleZh(entry.role)}</span>
            </li>
          ))}
      </ul>
    </section>
  )
}
