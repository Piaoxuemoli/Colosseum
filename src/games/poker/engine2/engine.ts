// 引擎核心（PFR-2xx 规则 / PFR-3xx 推进）：
// 纯逻辑状态机——无 I/O、无时间、无第二随机源；
// (状态, 输入) → (新状态, 事件) 纯函数语义，原状态不被修改（PFR-301）；
// 唯一行动者或自动推进不变式（PFR-302）：任何返回状态要么 awaiting-action，
// 要么 finished，绝无停滞态。

import { createOrderedDeck } from './cards'
import type { Card } from './cards'
import { levelForHand, resolveConfig } from './config'
import type { EventDraft, PokerEvent } from './events'
import { evaluateBest } from './evaluator'
import { awardPots, computePots } from './pots'
import { handSeedFrom, hashSeed, firstButtonSeat, mulberry32, shuffled } from './rng'
import type { RngSeed } from './rng'
import type {
  ActionRejection,
  ConfigOutcome,
  MatchFinish,
  MatchFinishReason,
  MatchState,
  NormalizedAction,
  PlayerState,
  Street,
} from './types'
import { validateAction } from './legal'

/** 非常规内部不变式被破坏时抛出（正常 API 永不触发，测试覆盖）。 */
export class EngineError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EngineError'
  }
}

export type CreateMatchOutcome =
  | { ok: true; state: MatchState; events: PokerEvent[] }
  | { ok: false; rejection: { code: string; message: string } }

export type ApplyActionOutcome =
  | { ok: true; state: MatchState; events: PokerEvent[] }
  | { ok: false; state: MatchState; rejection: ActionRejection }

/** 自动推进安全阈值：防极端退化配置（如全员同筹码无限平分）导致的死循环。 */
const MAX_AUTO_STEPS = 10000

// ---------------------------------------------------------------------------
// 对局创建（PFR-101/102）
// ---------------------------------------------------------------------------

export function createMatch(configInput: unknown, seed: RngSeed): CreateMatchOutcome {
  return createMatchFromMaster(configInput, hashSeed(seed))
}

/**
 * 以"已是主种子"的数值直接开局（重放路径使用，避免二次哈希；
 * 事件流中的 randomness-established.masterSeed 即此值，PFR-404/405）。
 */
export function createMatchFromMaster(configInput: unknown, masterSeed: number): CreateMatchOutcome {
  const resolved: ConfigOutcome = resolveConfig(configInput)
  if (!resolved.ok) {
    return { ok: false, rejection: { code: resolved.rejection.code, message: resolved.rejection.message } }
  }
  const config = resolved.config

  const players: PlayerState[] = config.seatIds.map((seatId, seat) => ({
    seatId,
    seat,
    stack: config.startingStack,
    status: 'active',
    holeCards: [],
    streetBet: 0,
    totalCommitted: 0,
    hasActed: false,
    revealed: false,
    rank: null,
  }))

  const state: MatchState = {
    seq: 0,
    config,
    masterSeed,
    phase: 'between-hands',
    currentActor: null,
    players,
    hand: null,
    handNumber: 0,
    level: 0,
    blinds: { ...config.initialBlinds },
    stopAfterHand: false,
    finish: null,
  }

  const events: PokerEvent[] = []
  emit(state, events, { kind: 'match-config', hand: 0, audience: { kind: 'public' }, seatIds: [...config.seatIds], startingStack: config.startingStack, blinds: { ...config.initialBlinds }, schedule: config.schedule ? { ...config.schedule, levels: config.schedule.levels.map((l) => ({ ...l })) } : null })
  emit(state, events, { kind: 'randomness-established', hand: 0, audience: { kind: 'delayed-public' }, masterSeed })
  driveLoop(state, events)
  return { ok: true, state, events }
}

// ---------------------------------------------------------------------------
// 玩家动作（PFR-205/206/207/503；PFR-103：注入动作同构）
// ---------------------------------------------------------------------------

export function applyAction(state: MatchState, seatId: string, raw: unknown): ApplyActionOutcome {
  const validated = validateAction(state, seatId, raw)
  if (!validated.ok) {
    // 拒绝零副作用：返回原状态引用与空事件（PFR-503）
    return { ok: false, state, rejection: validated.rejection }
  }
  const advanced = applyNormalizedAction(state, validated.normalized)
  return { ok: true, state: advanced.state, events: advanced.events }
}

/** 规范化动作推进（重放复用同一核心，保证 reduceEvents 与实时状态逐位一致）。 */
export function applyNormalizedAction(state: MatchState, normalized: NormalizedAction): { state: MatchState; events: PokerEvent[] } {
  const s = cloneState(state)
  const events: PokerEvent[] = []
  const h = s.hand
  if (!h || s.phase !== 'awaiting-action' || s.currentActor !== normalized.seatId) {
    throw new EngineError('applyNormalizedAction: 非法内部状态')
  }
  const p = playerBySeatId(s, normalized.seatId)
  if (!p) throw new EngineError('applyNormalizedAction: 未知行动者')

  switch (normalized.type) {
    case 'fold':
      p.status = 'folded'
      p.hasActed = true
      break
    case 'check':
      p.hasActed = true
      break
    case 'call':
      p.stack -= normalized.paid
      p.streetBet += normalized.paid
      p.totalCommitted += normalized.paid
      p.hasActed = true
      if (p.stack === 0) p.status = 'all-in'
      break
    case 'bet':
      p.stack -= normalized.paid
      p.streetBet = normalized.to
      p.totalCommitted += normalized.paid
      p.hasActed = true
      h.currentBet = normalized.to
      h.lastAggressorSeat = p.seat
      if (normalized.reopens) h.lastRaiseIncrement = normalized.to
      if (p.stack === 0) p.status = 'all-in'
      if (normalized.reopens) resetOthersHasActed(s, p.seatId)
      break
    case 'raise':
      p.stack -= normalized.paid
      p.streetBet = normalized.to
      p.totalCommitted += normalized.paid
      p.hasActed = true
      h.currentBet = normalized.to
      h.lastAggressorSeat = p.seat
      if (normalized.reopens) {
        h.lastRaiseIncrement = normalized.increment
        resetOthersHasActed(s, p.seatId)
      }
      if (p.stack === 0) p.status = 'all-in'
      break
  }

  s.currentActor = normalized.seatId // 供 driveLoop 定位扫描起点
  emit(s, events, { kind: 'action-made', hand: h.handNumber, audience: { kind: 'public' }, seatId: p.seatId, street: h.street, action: normalized })
  driveLoop(s, events)
  return { state: s, events }
}

// ---------------------------------------------------------------------------
// 受控结束（PFR-105/103）
// ---------------------------------------------------------------------------

export type CommandOutcome =
  | { ok: true; state: MatchState; events: PokerEvent[] }
  | { ok: false; state: MatchState; rejection: ActionRejection }

/** 指令 a：当前手结束后终止。 */
export function requestStopAfterCurrentHand(state: MatchState): CommandOutcome {
  if (state.phase === 'finished') {
    return {
      ok: false,
      state,
      rejection: { code: 'MATCH_ALREADY_FINISHED', message: '对局已终局，无需再请求终止' },
    }
  }
  if (state.stopAfterHand) {
    return { ok: true, state, events: [] } // 幂等：重复请求为无事件 no-op
  }
  const s = cloneState(state)
  const events: PokerEvent[] = []
  s.stopAfterHand = true
  emit(s, events, { kind: 'stop-requested', hand: s.handNumber, audience: { kind: 'public' } })
  return { ok: true, state: s, events }
}

/** 指令 b：立即终止，按当前筹码与存活状态结算排名。 */
export function terminateImmediately(state: MatchState): CommandOutcome {
  if (state.phase === 'finished') {
    return {
      ok: false,
      state,
      rejection: { code: 'MATCH_ALREADY_FINISHED', message: '对局已终局' },
    }
  }
  const s = cloneState(state)
  const events: PokerEvent[] = []
  finishMatch(s, events, 'controlled-immediate')
  return { ok: true, state: s, events }
}

// ---------------------------------------------------------------------------
// 状态分类（PFR-302 不变式的可判定出口）
// ---------------------------------------------------------------------------

export type StateClassification =
  | { kind: 'awaiting-action'; actor: string }
  | { kind: 'finished'; reason: MatchFinishReason; ranking: MatchFinish['ranking'] }

export function classifyState(state: MatchState): StateClassification {
  if (state.phase === 'finished') {
    return {
      kind: 'finished',
      reason: state.finish?.reason ?? 'natural',
      ranking: state.finish?.ranking ?? [],
    }
  }
  if (state.phase !== 'awaiting-action' || state.currentActor === null) {
    throw new EngineError('classifyState: 违反 PFR-302 不变式（出现停滞态）')
  }
  return { kind: 'awaiting-action', actor: state.currentActor }
}

// ---------------------------------------------------------------------------
// 内部：推进循环
// ---------------------------------------------------------------------------

function driveLoop(s: MatchState, events: PokerEvent[]): void {
  for (let step = 0; step < MAX_AUTO_STEPS; step++) {
    if (s.phase === 'finished') return

    if (s.phase === 'between-hands') {
      if (s.handNumber > 0) {
        emitHandSummary(s, events)
        const matchFinished = processEliminations(s, events)
        if (matchFinished) return
      }
      startNextHand(s, events)
      continue
    }

    // awaiting-action
    const h = s.hand
    if (!h) throw new EngineError('driveLoop: 缺少手牌帧')
    const inHand = s.players.filter((p) => p.status === 'active' || p.status === 'all-in')
    if (inHand.length <= 1) {
      // 弃牌至仅剩一人：直接赢池，不摊牌、不发剩余公共牌（PFR-203）
      settleHand(s, events, false)
      s.phase = 'between-hands'
      continue
    }

    const complete = inHand.every((p) => p.status === 'all-in' || (p.hasActed && p.streetBet === h.currentBet))
    if (!complete) {
      const actor = findNextActor(s)
      if (actor === null) throw new EngineError('driveLoop: 找不到下一行动者（PFR-302 违例）')
      s.currentActor = actor
      s.phase = 'awaiting-action'
      return
    }

    if (h.street === 'river') {
      // river 完成：强制全员亮牌 + 结算（PFR-209；OD-P3a 无 muck）
      revealFromAnchor(s, events, h.lastAggressorSeat)
      settleHand(s, events, true)
      s.phase = 'between-hands'
      continue
    }

    const canAct = inHand.filter((p) => p.status === 'active')
    if (canAct.length <= 1) {
      // 全下 run-out：自动逐街发完 → 亮牌 → 结算，比赛继续（PFR-210）
      const anchor = h.lastAggressorSeat
      emit(s, events, { kind: 'run-out-started', hand: h.handNumber, audience: { kind: 'public' } })
      while (s.hand !== null && s.hand.street !== 'river') {
        dealStreet(s, events, true)
      }
      revealFromAnchor(s, events, anchor)
      settleHand(s, events, true)
      s.phase = 'between-hands'
      continue
    }

    dealStreet(s, events, false)
    s.currentActor = null // 新街自街锚点（按钮左一 / preflop UTG）重新定位行动者
    const actor = findNextActor(s)
    if (actor === null) throw new EngineError('driveLoop: 新街无行动者（PFR-302 违例）')
    s.currentActor = actor
    return
  }
  throw new EngineError('driveLoop: 自动推进超出安全阈值（退化配置）')
}

function startNextHand(s: MatchState, events: PokerEvent[]): void {
  const handNumber = s.handNumber + 1
  const level = levelForHand(s.config, handNumber)
  if (s.config.schedule && level > s.level) {
    s.level = level
    s.blinds = { ...s.config.schedule.levels[level] }
    emit(s, events, { kind: 'blind-level-raised', hand: handNumber, audience: { kind: 'public' }, level, blinds: { ...s.blinds } })
  }

  const alive = s.players.filter((p) => p.status !== 'eliminated')
  const headsUp = alive.length === 2
  const button =
    handNumber === 1 ? firstButtonSeat(s.masterSeed, s.players.length) : nextAliveSeat(s, s.hand?.buttonSeat ?? 0)
  const sbSeat = headsUp ? button : nextAliveSeat(s, button)
  const bbSeat = nextAliveSeat(s, sbSeat)

  const handSeed = handSeedFrom(s.masterSeed, handNumber)
  const deck = shuffled(createOrderedDeck(), mulberry32(handSeed))

  emit(s, events, {
    kind: 'hand-started',
    hand: handNumber,
    audience: { kind: 'public' },
    handNumber,
    buttonSeat: button,
    sbSeat,
    bbSeat,
    headsUp,
    blinds: { ...s.blinds },
    level: s.level,
  })
  emit(s, events, { kind: 'deck-shuffled', hand: handNumber, audience: { kind: 'delayed-public' }, seed: handSeed })

  // 重置手牌级字段（PFR-101：出局者不再参与）
  for (const p of s.players) {
    p.holeCards = []
    p.streetBet = 0
    p.totalCommitted = 0
    p.hasActed = false
    p.revealed = false
    if (p.status !== 'eliminated') p.status = 'active'
  }

  // 底牌：存活座位升序，每家 2 张（cards.dealLayout 约定）
  let idx = 0
  const aliveBySeat = [...alive].sort((a, b) => a.seat - b.seat)
  for (const p of aliveBySeat) {
    p.holeCards = [deck[idx], deck[idx + 1]]
    idx += 2
    emit(s, events, { kind: 'hole-cards-dealt', hand: handNumber, audience: { kind: 'self', seatId: p.seatId }, seatId: p.seatId, cards: [...p.holeCards] })
  }
  const remaining = deck.slice(idx)

  // 盲注：短盲按剩余筹码全下（引擎代提交），位置权利保留（PFR-211）
  const posts: BlindsPostedPosts = []
  const startStacks = s.players.map((p) => p.stack)
  const sbPlayer = playerAtSeat(s, sbSeat)
  const bbPlayer = playerAtSeat(s, bbSeat)
  if (!sbPlayer || !bbPlayer) throw new EngineError('startNextHand: 盲注座位缺失')
  posts.push(postBlind(sbPlayer, s.blinds.sb, 'sb'))
  posts.push(postBlind(bbPlayer, s.blinds.bb, 'bb'))
  emit(s, events, { kind: 'blinds-posted', hand: handNumber, audience: { kind: 'public' }, posts })

  s.hand = {
    handNumber,
    handSeed,
    deck: remaining,
    board: [],
    street: 'preflop',
    buttonSeat: button,
    sbSeat,
    bbSeat,
    currentBet: s.blinds.bb,
    lastRaiseIncrement: s.blinds.bb,
    lastAggressorSeat: null,
    startStacks,
  }
  s.handNumber = handNumber
  s.phase = 'awaiting-action'
  s.currentActor = null // 首个行动者由 driveLoop 依街锚点推导
}

type BlindsPostedPosts = Array<{ seatId: string; blind: 'sb' | 'bb'; due: number; posted: number; allIn: boolean }>

function postBlind(p: PlayerState, due: number, blind: 'sb' | 'bb'): { seatId: string; blind: 'sb' | 'bb'; due: number; posted: number; allIn: boolean } {
  const posted = Math.min(p.stack, due)
  p.stack -= posted
  p.streetBet = posted
  p.totalCommitted = posted
  const allIn = p.stack === 0
  if (allIn) p.status = 'all-in'
  return { seatId: p.seatId, blind, due, posted, allIn }
}

function dealStreet(s: MatchState, events: PokerEvent[], auto: boolean): void {
  const h = s.hand
  if (!h) throw new EngineError('dealStreet: 缺少手牌帧')
  const next: Exclude<Street, 'preflop'> = h.street === 'preflop' ? 'flop' : h.street === 'flop' ? 'turn' : 'river'
  const count = next === 'flop' ? 3 : 1
  const cards: Card[] = h.deck.slice(0, count)
  h.deck = h.deck.slice(count)
  h.board = [...h.board, ...cards]
  h.street = next
  h.currentBet = 0
  h.lastRaiseIncrement = 0
  h.lastAggressorSeat = null
  for (const p of s.players) {
    p.streetBet = 0
    p.hasActed = false
  }
  emit(s, events, { kind: 'street-dealt', hand: h.handNumber, audience: { kind: 'public' }, street: next, cards, auto })
}

/** 摊牌亮牌：自锚点（最后进攻者，否则按钮左一第一个在手者）顺时针（PFR-209）。 */
function revealFromAnchor(s: MatchState, events: PokerEvent[], anchorSeat: number | null): void {
  const h = s.hand
  if (!h) throw new EngineError('revealFromAnchor: 缺少手牌帧')
  const n = s.players.length
  const anchor = anchorSeat ?? firstInHandFromButton(s)
  for (let i = 0; i < n; i++) {
    const p = s.players[(anchor + i) % n]
    if (p.status !== 'active' && p.status !== 'all-in') continue
    p.revealed = true
    emit(s, events, { kind: 'cards-revealed', hand: h.handNumber, audience: { kind: 'public' }, seatId: p.seatId, cards: [...p.holeCards] })
  }
}

function settleHand(s: MatchState, events: PokerEvent[], showdown: boolean): void {
  const h = s.hand
  if (!h) throw new EngineError('settleHand: 缺少手牌帧')
  const contributions = s.players
    .filter((p) => p.totalCommitted > 0)
    .map((p) => ({ seatId: p.seatId, committed: p.totalCommitted, folded: p.status === 'folded' }))
  const pots = computePots(contributions)

  const handValues = new Map<string, number>()
  if (showdown) {
    for (const p of s.players) {
      if (p.status === 'active' || p.status === 'all-in') {
        handValues.set(p.seatId, evaluateBest([...p.holeCards, ...h.board]).value)
      }
    }
  }

  const orderFromButton: string[] = []
  const n = s.players.length
  for (let i = 1; i <= n; i++) {
    orderFromButton.push(s.players[(h.buttonSeat + i) % n].seatId)
  }

  const awards = awardPots(pots, handValues, orderFromButton)
  for (const award of awards) {
    for (const w of award.winners) {
      const p = playerBySeatId(s, w.seatId)
      if (!p) throw new EngineError('settleHand: 赢家座位缺失')
      p.stack += w.total
    }
    emit(s, events, {
      kind: 'pot-awarded',
      hand: h.handNumber,
      audience: { kind: 'public' },
      potIndex: award.potIndex,
      amount: award.amount,
      eligibleSeatIds: [...award.eligibleSeatIds],
      winners: award.winners.map((w) => ({ ...w })),
    })
  }
}

function emitHandSummary(s: MatchState, events: PokerEvent[]): void {
  const h = s.hand
  if (!h) throw new EngineError('emitHandSummary: 缺少手牌帧')
  const results = s.players.map((p) => {
    const startStack = h.startStacks[p.seat]
    return {
      seatId: p.seatId,
      startStack,
      endStack: p.stack,
      delta: p.stack - startStack,
      eliminated: p.status !== 'eliminated' && p.stack === 0,
    }
  })
  emit(s, events, { kind: 'hand-ended', hand: h.handNumber, audience: { kind: 'public' }, handNumber: h.handNumber, results })
}

/** 淘汰与名次（PFR-101）：筹码归零即出局；同手多人出局按开手筹码多者名次高，再按按钮顺时针。返回 true 表示对局已终局。 */
function processEliminations(s: MatchState, events: PokerEvent[]): boolean {
  const h = s.hand
  if (!h) throw new EngineError('processEliminations: 缺少手牌帧')
  const busted = s.players.filter((p) => p.status !== 'eliminated' && p.stack === 0)
  if (busted.length > 0) {
    const n = s.players.length
    const dist = (seat: number) => (seat - h.buttonSeat + n) % n
    busted.sort((a, b) => {
      const d = h.startStacks[b.seat] - h.startStacks[a.seat]
      if (d !== 0) return d
      return dist(a.seat) - dist(b.seat)
    })
    let aliveCount = s.players.filter((p) => p.status !== 'eliminated').length
    for (const p of busted) {
      p.rank = aliveCount
      p.status = 'eliminated'
      p.holeCards = []
      emit(s, events, { kind: 'player-eliminated', hand: h.handNumber, audience: { kind: 'public' }, seatId: p.seatId, rank: aliveCount })
      aliveCount -= 1
    }
  }
  const survivors = s.players.filter((p) => p.status !== 'eliminated')
  if (survivors.length <= 1) {
    finishMatch(s, events, 'natural')
    return true
  }
  if (s.stopAfterHand) {
    finishMatch(s, events, 'controlled-after-hand')
    return true
  }
  return false
}

function finishMatch(s: MatchState, events: PokerEvent[], reason: MatchFinishReason): void {
  const midHand = s.hand !== null && reason === 'controlled-immediate'
  const effective = (p: PlayerState) => (midHand ? p.stack + p.totalCommitted : p.stack)
  const survivors = s.players
    .filter((p) => p.status !== 'eliminated')
    .sort((a, b) => {
      const d = effective(b) - effective(a)
      if (d !== 0) return d
      return a.seat - b.seat
    })
  survivors.forEach((p, i) => {
    p.rank = i + 1
  })
  const ranking = [...s.players]
    .map((p) => ({ seatId: p.seatId, rank: p.rank ?? 0, chips: effective(p) }))
    .sort((a, b) => a.rank - b.rank)
  const terminatedAt = reason === 'natural' ? null : { seq: s.seq + 1, hand: s.handNumber }
  const finish: MatchFinish = { reason, ranking, terminatedAt }
  s.finish = finish
  s.phase = 'finished'
  s.currentActor = null
  s.hand = null
  emit(s, events, { kind: 'match-finished', hand: s.handNumber, audience: { kind: 'public' }, reason, ranking: ranking.map((r) => ({ ...r })), terminatedAt })
}

// ---------------------------------------------------------------------------
// 内部：行动者定位与座位遍历（PFR-204 顺序）
// ---------------------------------------------------------------------------

function aliveCount(s: MatchState): number {
  return s.players.filter((p) => p.status !== 'eliminated').length
}

function findNextActor(s: MatchState): string | null {
  const h = s.hand
  if (!h) return null
  const n = s.players.length
  const headsUp = aliveCount(s) === 2
  let start: number
  if (s.currentActor !== null) {
    const current = s.players.find((p) => p.seatId === s.currentActor)
    if (!current) throw new EngineError('findNextActor: 当前行动者座位缺失')
    start = (current.seat + 1) % n
  } else {
    // 街锚点（含）：preflop = BB 左一（heads-up 为按钮/SB）；postflop = 按钮左一（heads-up 为 BB）
    start =
      h.street === 'preflop'
        ? headsUp
          ? h.sbSeat
          : (h.bbSeat + 1) % n
        : headsUp
          ? h.bbSeat
          : (h.buttonSeat + 1) % n
  }
  for (let i = 0; i < n; i++) {
    const p = s.players[(start + i) % n]
    if (p.status !== 'active') continue
    if (!p.hasActed || p.streetBet < h.currentBet) return p.seatId
  }
  return null
}

function firstInHandFromButton(s: MatchState): number {
  const h = s.hand
  if (!h) throw new EngineError('firstInHandFromButton: 缺少手牌帧')
  const n = s.players.length
  for (let i = 1; i <= n; i++) {
    const idx = (h.buttonSeat + i) % n
    const p = s.players[idx]
    if (p.status === 'active' || p.status === 'all-in') return idx
  }
  throw new EngineError('firstInHandFromButton: 无在手玩家')
}

function nextAliveSeat(s: MatchState, from: number): number {
  const n = s.players.length
  for (let i = 1; i <= n; i++) {
    const idx = (from + i) % n
    if (s.players[idx].status !== 'eliminated') return idx
  }
  return from
}

function resetOthersHasActed(s: MatchState, actorSeatId: string): void {
  for (const p of s.players) {
    if (p.seatId !== actorSeatId && p.status === 'active') p.hasActed = false
  }
}

function playerBySeatId(s: MatchState, seatId: string): PlayerState | null {
  return s.players.find((p) => p.seatId === seatId) ?? null
}

function playerAtSeat(s: MatchState, seat: number): PlayerState | null {
  return s.players.find((p) => p.seat === seat) ?? null
}

// ---------------------------------------------------------------------------
// 内部：事件发射与克隆
// ---------------------------------------------------------------------------

function emit(s: MatchState, events: PokerEvent[], draft: EventDraft): void {
  s.seq += 1
  events.push({ ...draft, seq: s.seq } as PokerEvent)
}

function cloneState(state: MatchState): MatchState {
  return {
    ...state,
    blinds: { ...state.blinds },
    players: state.players.map((p) => ({ ...p, holeCards: [...p.holeCards] })),
    hand: state.hand
      ? { ...state.hand, deck: [...state.hand.deck], board: [...state.hand.board], startStacks: [...state.hand.startStacks] }
      : null,
    finish: state.finish
      ? { ...state.finish, ranking: state.finish.ranking.map((r) => ({ ...r })), terminatedAt: state.finish.terminatedAt ? { ...state.finish.terminatedAt } : null }
      : null,
  }
}
