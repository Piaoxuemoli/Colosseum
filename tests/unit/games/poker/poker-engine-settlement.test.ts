import { describe, expect, it } from 'vitest'
import type { Card, Rank } from '@/games/poker/engine/card'
import { createDeck } from '@/games/poker/engine/card'
import { PokerEngine } from '@/games/poker/engine/poker-engine'
import type { PokerConfig, PokerPlayerStatus, PokerState } from '@/games/poker/engine/poker-types'

const defaultConfig: PokerConfig = {
  smallBlind: 2,
  bigBlind: 4,
  startingChips: 200,
  maxBetsPerStreet: 4,
}

const engine = new PokerEngine()

const SUIT_MAP = { h: 'hearts', d: 'diamonds', c: 'clubs', s: 'spades' } as const

function c(code: string): Card {
  return {
    rank: code[0] as Rank,
    suit: SUIT_MAP[code[1] as keyof typeof SUIT_MAP],
  }
}

function cards(...codes: string[]): Card[] {
  return codes.map(c)
}

function playerOf(state: PokerState, id: string | null) {
  return state.players.find((candidate) => candidate.id === id)
}

interface CraftedPlayer {
  id: string
  hole: Card[]
  chips: number
  committed: number
  status?: PokerPlayerStatus
}

// 构造一个已经进入翻牌圈的确定性局面：底牌、公共牌、剩余牌组都由测试指定。
function craftFlopHand(input: { players: CraftedPlayer[]; board: Card[]; runout: Card[] }): PokerState {
  const ids = input.players.map((player) => player.id)
  const base = engine.createInitialState(defaultConfig, ids)

  const used = new Set<string>()
  for (const player of input.players) {
    for (const card of player.hole) used.add(`${card.rank}${card.suit}`)
  }
  for (const card of [...input.board, ...input.runout]) used.add(`${card.rank}${card.suit}`)
  const filler = createDeck().filter((card) => !used.has(`${card.rank}${card.suit}`))

  const pot = input.players.reduce((sum, player) => sum + player.committed, 0)
  const statusOf = (player: CraftedPlayer): PokerPlayerStatus =>
    player.status ?? (player.chips === 0 ? 'allIn' : 'active')
  const firstActor = input.players.find((player) => statusOf(player) === 'active')

  return {
    ...base,
    phase: 'flop',
    communityCards: [...input.board],
    deck: [...input.runout, ...filler],
    betsThisStreet: 0,
    pot,
    streetPots: { preflop: pot, flop: 0, turn: 0, river: 0 },
    sidePots: [],
    actionHistory: [],
    handComplete: false,
    matchComplete: false,
    currentActor: firstActor?.id ?? input.players[0].id,
    players: input.players.map((player, index) => ({
      id: player.id,
      seatIndex: index,
      chips: player.chips,
      holeCards: [...player.hole],
      status: statusOf(player),
      currentBet: 0,
      totalCommitted: player.committed,
      hasActedThisStreet: false,
    })),
  }
}

// 从构造局面一路 check 到摊牌结算，收集沿途全部事件
function checkDown(state: PokerState): { final: PokerState; events: ReturnType<typeof engine.applyAction>['events'] } {
  let current = state
  const events: ReturnType<typeof engine.applyAction>['events'] = []
  let guard = 40
  while (!current.handComplete && guard-- > 0) {
    const actor = engine.currentActor(current)
    if (!actor) break
    const result = engine.applyAction(current, actor, { type: 'check' })
    current = result.nextState
    events.push(...result.events)
  }
  return { final: current, events }
}

// 真实开局后全员弃牌，返回结算完毕的手
function foldOutHand(ids: string[]): PokerState {
  let state = engine.createInitialState(defaultConfig, ids)
  for (let i = 0; i < ids.length - 1; i++) {
    const actor = engine.currentActor(state)
    if (!actor) break
    state = engine.applyAction(state, actor, { type: 'fold' }).nextState
  }
  expect(state.handComplete).toBe(true)
  return state
}

function potAwardEvents(events: ReturnType<typeof engine.applyAction>['events']) {
  return events
    .filter((event) => event.kind === 'poker/pot-award')
    .map((event) => event.payload as { potAmount: number; winnerIds: string[] })
}

describe('PokerEngine 摊牌结算', () => {
  it('单挑摊牌：强牌通吃底池，结算后会计状态复位', () => {
    const state = craftFlopHand({
      players: [
        { id: 'a', hole: cards('Ah', 'Ad'), chips: 196, committed: 4 },
        { id: 'b', hole: cards('Kh', '7c'), chips: 196, committed: 4 },
      ],
      board: cards('As', 'Kd', '2c'),
      runout: cards('9s', '9d'),
    })

    const { final } = checkDown(state)

    expect(final.phase).toBe('showdown')
    expect(final.handComplete).toBe(true)
    expect(final.currentActor).toBeNull()
    expect(final.communityCards).toHaveLength(5)
    // a 的 AAA99 葫芦胜 b 的两对
    expect(playerOf(final, 'a')?.chips).toBe(204)
    expect(playerOf(final, 'b')?.chips).toBe(196)
    expect(final.pot).toBe(0)
    expect(final.sidePots).toEqual([])
    expect(final.streetPots).toEqual({ preflop: 0, flop: 0, turn: 0, river: 0 })
    expect(final.players.every((player) => player.totalCommitted === 0)).toBe(true)
  })

  it('pot-award 事件记录金额与赢家', () => {
    const state = craftFlopHand({
      players: [
        { id: 'a', hole: cards('Ah', 'Ad'), chips: 196, committed: 4 },
        { id: 'b', hole: cards('Kh', '7c'), chips: 196, committed: 4 },
      ],
      board: cards('As', 'Kd', '2c'),
      runout: cards('9s', '9d'),
    })

    const { events } = checkDown(state)

    expect(potAwardEvents(events)).toEqual([{ potAmount: 8, winnerIds: ['a'] }])
  })

  it('双方打板平分底池，奇数筹码归座位靠前者', () => {
    // 公共牌四条 A + K，双方底牌均不参与 → 完全平局
    // 弃牌者 c 的 1 颗死钱滚入主池，形成 7 筹码的奇数池
    const state = craftFlopHand({
      players: [
        { id: 'a', hole: cards('2h', '3h'), chips: 198, committed: 2 },
        { id: 'b', hole: cards('4s', '5s'), chips: 198, committed: 2 },
        { id: 'c', hole: cards('6d', '7d'), chips: 197, committed: 3, status: 'folded' },
      ],
      board: cards('Ah', 'As', 'Ad'),
      runout: cards('Ac', 'Kc'),
    })

    const { final } = checkDown(state)

    // 7 = 3 + 3 + 1：平分 3/3，剩 1 颗给 eligible 顺序第一位（座位 0 的 a）
    expect(playerOf(final, 'a')?.chips).toBe(202)
    expect(playerOf(final, 'b')?.chips).toBe(201)
    expect(playerOf(final, 'c')?.chips).toBe(197)
    expect(final.pot).toBe(0)
  })

  it('未被跟注的差额形成私有池并直接归还未跟注方', () => {
    // a 投入 3，b 投入 4：主池 6 平分，b 多出的 1 筹码无人有资格争夺
    const state = craftFlopHand({
      players: [
        { id: 'a', hole: cards('2h', '3h'), chips: 197, committed: 3 },
        { id: 'b', hole: cards('4s', '5s'), chips: 196, committed: 4 },
      ],
      board: cards('Ah', 'As', 'Ad'),
      runout: cards('Ac', 'Kc'),
    })

    const { final } = checkDown(state)

    expect(playerOf(final, 'a')?.chips).toBe(200)
    expect(playerOf(final, 'b')?.chips).toBe(200)
  })

  it('多层边池：短码 all-in 只赢主池，边池由其余人竞争', () => {
    const state = craftFlopHand({
      players: [
        { id: 'a', hole: cards('Ah', 'Ad'), chips: 0, committed: 2 },
        { id: 'b', hole: cards('Kh', 'Kc'), chips: 190, committed: 10 },
        { id: 'c', hole: cards('Qh', 'Qc'), chips: 190, committed: 10 },
      ],
      board: cards('As', '7d', '2c'),
      runout: cards('9s', '9d'),
    })

    const { final } = checkDown(state)

    // 主池 6（a/b/c 各 2）→ a 的明三条改进为葫芦获胜
    // 边池 16（b/c 各 8）→ b 的 KK 压过 c 的 QQ
    expect(playerOf(final, 'a')?.chips).toBe(6)
    expect(playerOf(final, 'b')?.chips).toBe(206)
    expect(playerOf(final, 'c')?.chips).toBe(190)
    expect(final.pot).toBe(0)
    expect(final.players.reduce((sum, player) => sum + player.chips, 0)).toBe(402)
  })

  it('弃牌者的死钱全部归摊牌赢家', () => {
    const state = craftFlopHand({
      players: [
        { id: 'a', hole: cards('6d', '7d'), chips: 190, committed: 10, status: 'folded' },
        { id: 'b', hole: cards('Ah', 'Ad'), chips: 190, committed: 10 },
        { id: 'c', hole: cards('Kh', 'Kc'), chips: 190, committed: 10 },
      ],
      board: cards('As', '7d', '2c'),
      runout: cards('9s', '9d'),
    })

    const { final } = checkDown(state)

    expect(playerOf(final, 'b')?.chips).toBe(220)
    expect(playerOf(final, 'a')?.chips).toBe(190)
    expect(playerOf(final, 'c')?.chips).toBe(190)
  })

  it('全员弃牌：幸存者不经摊牌直接赢得底池', () => {
    const final = foldOutHand(['a', 'b', 'c'])

    const survivor = final.players.find((player) => player.status === 'active')
    expect(survivor).toBeDefined()
    // 幸存者是大盲：196 + 底池 6（小盲 2 + 大盲 4）
    expect(survivor!.chips).toBe(defaultConfig.startingChips - defaultConfig.bigBlind + 6)
    expect(final.players.reduce((sum, player) => sum + player.chips, 0)).toBe(defaultConfig.startingChips * 3)
    expect(final.phase).toBe('preflop')
    expect(final.handComplete).toBe(true)
    expect(final.pot).toBe(0)
  })
})

describe('PokerEngine 淘汰与下一手', () => {
  function endedShowdownState(): PokerState {
    const base = engine.createInitialState(defaultConfig, ['a', 'b', 'c'])
    return {
      ...base,
      phase: 'showdown',
      handComplete: true,
      matchComplete: false,
      stopRequested: false,
      currentActor: null,
      deck: [],
      communityCards: [],
      actionHistory: [],
      pot: 0,
      streetPots: { preflop: 0, flop: 0, turn: 0, river: 0 },
      sidePots: [],
      dealerIndex: 0,
      players: base.players.map((player, index) => ({
        ...player,
        chips: [0, 300, 300][index],
        status: 'active',
        currentBet: 0,
        totalCommitted: 0,
        holeCards: [],
        hasActedThisStreet: false,
      })),
    }
  }

  it('筹码归零的玩家在下一手被标记淘汰且不发牌', () => {
    const { nextState, events } = engine.continueAfterHand(endedShowdownState())

    expect(nextState.handComplete).toBe(false)
    expect(nextState.matchComplete).toBe(false)
    expect(nextState.handNumber).toBe(2)
    expect(nextState.phase).toBe('preflop')
    expect(events.some((event) => event.kind === 'poker/hand-start')).toBe(true)

    const busted = playerOf(nextState, 'a')
    expect(busted?.status).toBe('eliminated')
    expect(busted?.holeCards).toEqual([])

    // 幸存两人正常发牌
    expect(playerOf(nextState, 'b')?.holeCards).toHaveLength(2)
    expect(playerOf(nextState, 'c')?.holeCards).toHaveLength(2)
    expect(nextState.deck).toHaveLength(52 - 4)

    // 庄家轮转跳过被淘汰座位：旧庄家 0 → 新庄家 1；两人局庄家即小盲
    expect(nextState.dealerIndex).toBe(1)
    expect(nextState.smallBlindIndex).toBe(1)
    expect(nextState.bigBlindIndex).toBe(2)
    expect(nextState.pot).toBe(6)
    expect(nextState.currentActor).toBe('b')
  })

  it('只剩一名玩家有筹码时比赛结束并广播冠军', () => {
    const state = endedShowdownState()
    state.players = state.players.map((player, index) => ({
      ...player,
      chips: index === 1 ? 600 : 0,
      status: index === 1 ? 'active' : 'eliminated',
    }))

    const { nextState, events } = engine.continueAfterHand(state)

    expect(nextState.matchComplete).toBe(true)
    expect(nextState.handComplete).toBe(true)
    expect(nextState.currentActor).toBeNull()
    expect(nextState.handNumber).toBe(1) // 不再开新的一手
    expect(events.some((event) => event.kind === 'poker/match-end')).toBe(true)
    const matchEnd = events.find((event) => event.kind === 'poker/match-end')
    expect(matchEnd?.payload).toEqual({ winnerId: 'b' })
    expect(events.some((event) => event.kind === 'poker/hand-start')).toBe(false)
  })

  it('请求停赛后当前手结束即收官', () => {
    const ended = foldOutHand(['a', 'b', 'c'])
    const stopped = engine.requestStopAfterHand(ended)

    expect(stopped.stopRequested).toBe(true)
    expect(ended.stopRequested).toBe(false) // 返回克隆，不改动原状态

    const { nextState, events } = engine.continueAfterHand(stopped)

    expect(nextState.matchComplete).toBe(true)
    expect(events.some((event) => event.kind === 'poker/match-end')).toBe(true)
  })
})

describe('PokerEngine boundary / finalize / publicState', () => {
  it('boundary：手结束与比赛结束的边界识别', () => {
    const state = engine.createInitialState(defaultConfig, ['a', 'b', 'c'])

    expect(engine.boundary(state, { ...state, handNumber: 2 })).toBeNull()
    expect(engine.boundary(state, { ...state, handComplete: true })).toBe('hand-end')
    expect(engine.boundary(state, { ...state, matchComplete: true })).toBe('match-end')
    // 两个边界同时翻转时 hand-end 优先
    expect(engine.boundary(state, { ...state, handComplete: true, matchComplete: true })).toBe('hand-end')
  })

  it('finalize：按筹码降序产出排名', () => {
    const state = engine.createInitialState(defaultConfig, ['a', 'b', 'c', 'd', 'e', 'f'])
    const chips = [500, 300, 200, 100, 50, 0]
    state.players = state.players.map((player, index) => ({ ...player, chips: chips[index] }))

    const result = engine.finalize(state)

    expect(result.winnerFaction).toBeNull()
    expect(result.ranking.map((entry) => entry.agentId)).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
    expect(result.ranking.map((entry) => entry.rank)).toEqual([1, 2, 3, 4, 5, 6])
    expect(result.ranking.map((entry) => entry.score)).toEqual(chips)
  })

  it('createPublicState：隐藏内部字段且与原状态深拷贝隔离', () => {
    const state = engine.createInitialState(defaultConfig, ['a', 'b', 'c'])
    const snapshot = engine.createPublicState(state)

    expect(snapshot.phase).toBe('preflop')
    expect(snapshot.currentActor).toBe(state.currentActor)
    expect(snapshot.players[0]).not.toHaveProperty('totalCommitted')
    expect(snapshot.players[0]).not.toHaveProperty('hasActedThisStreet')
    const hidden = snapshot as unknown as Record<string, unknown>
    expect(hidden.deck).toBeUndefined()
    expect(hidden.actionHistory).toBeUndefined()

    // 修改快照不影响引擎状态
    snapshot.communityCards.push(c('2c'))
    snapshot.players[0].holeCards.pop()
    expect(state.communityCards).toHaveLength(0)
    expect(state.players[0].holeCards).toHaveLength(2)
  })
})
