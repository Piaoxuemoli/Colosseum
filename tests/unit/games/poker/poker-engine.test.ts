import { describe, expect, it } from 'vitest'
import { PokerEngine } from '@/games/poker/engine/poker-engine'
import type { PokerAction, PokerConfig, PokerState } from '@/games/poker/engine/poker-types'

const defaultConfig: PokerConfig = {
  smallBlind: 2,
  bigBlind: 4,
  startingChips: 200,
  maxBetsPerStreet: 4,
}

const engine = new PokerEngine()

function initState(ids: string[]): PokerState {
  return engine.createInitialState(defaultConfig, ids)
}

function playerOf(state: PokerState, id: string | null) {
  return state.players.find((candidate) => candidate.id === id)
}

// 让所有玩家 check/call 直到目标阶段（或手牌结束）
function driveToStreet(state: PokerState, target: PokerState['phase']): PokerState {
  let current = state
  let guard = 60

  while (current.phase !== target && !current.handComplete && guard-- > 0) {
    const actor = engine.currentActor(current)
    if (!actor) break
    const player = playerOf(current, actor)
    if (!player) break
    const maxBet = Math.max(...current.players.map((candidate) => candidate.currentBet))
    const toCall = maxBet - player.currentBet
    const action: PokerAction = toCall > 0 ? { type: 'call', amount: toCall } : { type: 'check' }
    current = engine.applyAction(current, actor, action).nextState
  }

  return current
}

describe('PokerEngine.createInitialState', () => {
  it('6 人桌：盲注、底池、牌组、底牌齐备', () => {
    const state = initState(['a', 'b', 'c', 'd', 'e', 'f'])

    expect(state.phase).toBe('preflop')
    expect(state.handNumber).toBe(1)
    expect(state.communityCards).toHaveLength(0)
    expect(state.betsThisStreet).toBe(1)

    // 12 张底牌 + 40 张剩余
    expect(state.players.every((player) => player.holeCards.length === 2)).toBe(true)
    const holeKeys = new Set(
      state.players.flatMap((player) => player.holeCards.map((card) => `${card.rank}${card.suit}`)),
    )
    expect(holeKeys.size).toBe(12)
    expect(state.deck).toHaveLength(52 - 12)

    // 盲注
    const smallBlind = state.players.find((player) => player.currentBet === defaultConfig.smallBlind)
    const bigBlind = state.players.find((player) => player.currentBet === defaultConfig.bigBlind)
    expect(smallBlind).toBeDefined()
    expect(bigBlind).toBeDefined()
    expect(smallBlind!.chips).toBe(defaultConfig.startingChips - defaultConfig.smallBlind)
    expect(bigBlind!.chips).toBe(defaultConfig.startingChips - defaultConfig.bigBlind)
    expect(state.pot).toBe(defaultConfig.smallBlind + defaultConfig.bigBlind)
    expect(state.streetPots.preflop).toBe(defaultConfig.smallBlind + defaultConfig.bigBlind)

    // 庄家轮转：SB = dealer+1，BB = dealer+2，UTG = dealer+3
    expect(state.smallBlindIndex).toBe((state.dealerIndex + 1) % 6)
    expect(state.bigBlindIndex).toBe((state.dealerIndex + 2) % 6)
    expect(playerOf(state, state.currentActor)?.seatIndex).toBe((state.dealerIndex + 3) % 6)
  })

  it('6 人桌：发牌后的即时边池视图按盲注分层', () => {
    const state = initState(['a', 'b', 'c', 'd', 'e', 'f'])
    const smallBlindId = state.players[state.smallBlindIndex].id
    const bigBlindId = state.players[state.bigBlindIndex].id

    // 层 0-2：SB/BB 各贡献 2；层 2-4：BB 单独贡献 2
    expect(state.sidePots).toHaveLength(2)
    expect(state.sidePots[0]).toEqual({ amount: 4, eligiblePlayerIds: [smallBlindId, bigBlindId] })
    expect(state.sidePots[1]).toEqual({ amount: 2, eligiblePlayerIds: [bigBlindId] })
  })

  it('单挑局：庄家即小盲，翻牌前先行动', () => {
    const state = initState(['a', 'b'])

    expect(state.smallBlindIndex).toBe(state.dealerIndex)
    expect(state.bigBlindIndex).toBe((state.dealerIndex + 1) % 2)
    expect(state.currentActor).toBe(state.players[state.dealerIndex].id)
  })

  it('少于 2 名玩家时抛错', () => {
    expect(() => engine.createInitialState(defaultConfig, ['a'])).toThrow(/at least 2/)
  })
})

describe('PokerEngine.availableActions', () => {
  it('翻牌前 UTG：可 fold/call/raise，不可 check', () => {
    const state = initState(['a', 'b', 'c', 'd', 'e', 'f'])
    const actor = state.currentActor!

    const specs = engine.availableActions(state, actor)
    const types = specs.map((spec) => spec.type)

    expect(types).toContain('fold')
    expect(types).toContain('call')
    expect(types).toContain('raise')
    expect(types).not.toContain('check')

    const call = specs.find((spec) => spec.type === 'call')!
    expect(call.minAmount).toBe(defaultConfig.bigBlind)
    expect(call.maxAmount).toBe(defaultConfig.bigBlind)

    // 小注街（翻牌前）加注到 BB + SB
    const raise = specs.find((spec) => spec.type === 'raise')!
    expect(raise.minAmount).toBe(defaultConfig.bigBlind + defaultConfig.smallBlind)
    expect(raise.label).toBe(`raise to ${defaultConfig.bigBlind + defaultConfig.smallBlind}`)
  })

  it('翻牌圈无人下注时：可 check/bet，注额为小盲', () => {
    const state = driveToStreet(initState(['a', 'b', 'c']), 'flop')
    expect(state.phase).toBe('flop')

    const specs = engine.availableActions(state, state.currentActor!)
    const types = specs.map((spec) => spec.type)

    expect(types).toContain('check')
    expect(types).toContain('bet')
    expect(types).not.toContain('fold')
    expect(types).not.toContain('call')

    const bet = specs.find((spec) => spec.type === 'bet')!
    expect(bet.minAmount).toBe(defaultConfig.smallBlind)
    expect(bet.maxAmount).toBe(defaultConfig.smallBlind)
  })

  it('转牌圈（大注街）注额为大盲', () => {
    const state = driveToStreet(initState(['a', 'b', 'c']), 'turn')

    const bet = engine.availableActions(state, state.currentActor!).find((spec) => spec.type === 'bet')!
    expect(bet.minAmount).toBe(defaultConfig.bigBlind)
  })

  it('单挑局小盲面对大盲：只能 fold/call/raise，没有 check', () => {
    const state = initState(['a', 'b'])
    const actor = state.currentActor!

    const types = engine.availableActions(state, actor).map((spec) => spec.type)
    expect(types).not.toContain('check')
    expect(types).toContain('fold')
    expect(types).toContain('call')
  })

  it('每街下注数达到 4 后不再提供 bet/raise/allIn', () => {
    const state = { ...initState(['a', 'b', 'c']), betsThisStreet: 4 }
    const actor = state.currentActor!

    const types = engine.availableActions(state, actor).map((spec) => spec.type)
    expect(types).not.toContain('raise')
    expect(types).not.toContain('bet')
    expect(types).not.toContain('allIn')
    expect(types).toContain('fold')
    expect(types).toContain('call')
  })

  it('筹码不足以完整加注但多于跟注时提供 allIn', () => {
    const base = initState(['a', 'b', 'c'])
    const state: PokerState = {
      ...base,
      betsThisStreet: 2,
      pot: 12,
      currentActor: 'a',
      players: base.players.map((player, index) => ({
        ...player,
        chips: [5, 196, 194][index],
        currentBet: [2, 4, 6][index],
        totalCommitted: [2, 4, 6][index],
        hasActedThisStreet: index === 2,
      })),
    }

    const specs = engine.availableActions(state, 'a')
    const allIn = specs.find((spec) => spec.type === 'allIn')

    // toCall=4，筹码 5 不足以加注到 8，只能全下 5
    expect(allIn).toBeDefined()
    expect(allIn!.minAmount).toBe(5)
    expect(allIn!.maxAmount).toBe(5)
    expect(specs.map((spec) => spec.type)).not.toContain('raise')
  })

  it('非行动状态玩家与未知玩家没有可用动作', () => {
    const state = initState(['a', 'b', 'c'])
    const actor = state.currentActor!
    const folded = engine.applyAction(state, actor, { type: 'fold' }).nextState

    expect(engine.availableActions(folded, actor)).toEqual([])
    expect(engine.availableActions(state, 'nobody')).toEqual([])
  })
})

describe('PokerEngine.applyAction 基础动作', () => {
  it('fold：标记弃牌且不改动原状态（不可变性）', () => {
    const state = initState(['a', 'b', 'c'])
    const actor = state.currentActor!

    const { nextState, events } = engine.applyAction(state, actor, { type: 'fold' })

    expect(nextState).not.toBe(state)
    expect(playerOf(nextState, actor)?.status).toBe('folded')
    expect(playerOf(nextState, actor)?.hasActedThisStreet).toBe(true)
    expect(playerOf(state, actor)?.status).toBe('active')
    expect(state.actionHistory).toHaveLength(0)
    expect(nextState.actionHistory).toHaveLength(1)
    expect(events.some((event) => event.kind === 'poker/action' && event.payload.type === 'fold')).toBe(true)
  })

  it('面对下注时 check 被拒绝并返回 rejection 事件', () => {
    const state = initState(['a', 'b', 'c'])
    const actor = state.currentActor!

    const { nextState, events } = engine.applyAction(state, actor, { type: 'check' })

    expect(events).toHaveLength(1)
    expect(events[0].kind).toBe('poker/rejection')
    expect(events[0].payload.reason).toBe('cannot check facing bet')
    expect(playerOf(nextState, actor)?.status).toBe('active')
    expect(nextState.actionHistory).toHaveLength(0)
  })

  it('call：补齐到最高下注并计入底池', () => {
    const state = initState(['a', 'b', 'c'])
    const actor = state.currentActor!

    const { nextState, events } = engine.applyAction(state, actor, { type: 'call', amount: 4 })

    const player = playerOf(nextState, actor)!
    expect(player.currentBet).toBe(defaultConfig.bigBlind)
    expect(player.chips).toBe(defaultConfig.startingChips - defaultConfig.bigBlind)
    expect(player.totalCommitted).toBe(defaultConfig.bigBlind)
    expect(player.hasActedThisStreet).toBe(true)
    expect(nextState.pot).toBe(state.pot + defaultConfig.bigBlind)
    expect(nextState.streetPots.preflop).toBe(defaultConfig.smallBlind + defaultConfig.bigBlind + defaultConfig.bigBlind)
    expect(events[0].payload).toEqual({ type: 'call', amount: 4 })
  })

  it('bet：金额不超过当前最高注时被拒绝', () => {
    const state = initState(['a', 'b', 'c'])
    const actor = state.currentActor!

    const { nextState, events } = engine.applyAction(state, actor, { type: 'bet', amount: 3 })

    expect(events[0].kind).toBe('poker/rejection')
    expect(events[0].payload.reason).toBe('invalid bet size')
    expect(playerOf(nextState, actor)?.chips).toBe(defaultConfig.startingChips)
  })

  it('bet：翻牌圈成功下注重置其他玩家行动标记', () => {
    const state = driveToStreet(initState(['a', 'b', 'c']), 'flop')
    const actor = state.currentActor!

    const { nextState } = engine.applyAction(state, actor, { type: 'bet', amount: 2 })

    const bettor = playerOf(nextState, actor)!
    expect(bettor.currentBet).toBe(2)
    expect(bettor.chips).toBe(defaultConfig.startingChips - 4 - 2) // 翻牌前跟了 4
    expect(nextState.pot).toBe(state.pot + 2)
    expect(nextState.streetPots.flop).toBe(2)
    expect(nextState.betsThisStreet).toBe(1)

    for (const player of nextState.players) {
      if (player.id !== actor) expect(player.hasActedThisStreet).toBe(false)
    }
  })

  it('raise：加注到目标额度并推进每街下注数', () => {
    const state = initState(['a', 'b', 'c'])
    const actor = state.currentActor!

    const { nextState } = engine.applyAction(state, actor, { type: 'raise', toAmount: 6 })

    const raiser = playerOf(nextState, actor)!
    expect(raiser.currentBet).toBe(6)
    expect(raiser.chips).toBe(defaultConfig.startingChips - 6)
    expect(nextState.betsThisStreet).toBe(state.betsThisStreet + 1)
    expect(engine.currentActor(nextState)).not.toBe(actor)
  })

  it('raise：加注额度低于当前最高注被拒绝', () => {
    const state = initState(['a', 'b', 'c'])
    const actor = state.currentActor!

    const { events } = engine.applyAction(state, actor, { type: 'raise', toAmount: 4 })

    expect(events[0].kind).toBe('poker/rejection')
    expect(events[0].payload.reason).toBe('invalid bet size')
  })

  it('allIn：全额超加注计入下注数并重置他人', () => {
    const state = initState(['a', 'b'])
    const actor = state.currentActor!

    const { nextState } = engine.applyAction(state, actor, { type: 'allIn', amount: 198 })

    const shover = playerOf(nextState, actor)!
    expect(shover.chips).toBe(0)
    expect(shover.status).toBe('allIn')
    expect(shover.currentBet).toBe(defaultConfig.startingChips)
    expect(nextState.pot).toBe(state.pot + defaultConfig.startingChips - defaultConfig.smallBlind)
    expect(nextState.betsThisStreet).toBe(state.betsThisStreet + 1)
    expect(nextState.currentActor).not.toBe(actor)
  })

  it('allIn：短码全下未超过最高注时不重开行动', () => {
    const base = initState(['a', 'b', 'c'])
    const state: PokerState = {
      ...base,
      betsThisStreet: 2,
      pot: 12,
      currentActor: 'a',
      players: base.players.map((player, index) => ({
        ...player,
        chips: [3, 196, 194][index],
        currentBet: [2, 4, 6][index],
        totalCommitted: [2, 4, 6][index],
        hasActedThisStreet: index === 2,
      })),
    }

    const { nextState } = engine.applyAction(state, 'a', { type: 'allIn', amount: 3 })

    const shortStack = playerOf(nextState, 'a')!
    expect(shortStack.chips).toBe(0)
    expect(shortStack.status).toBe('allIn')
    expect(shortStack.currentBet).toBe(5)
    expect(nextState.betsThisStreet).toBe(2) // 不增加
    expect(nextState.pot).toBe(15)
    // 已行动的加注者未被重置
    expect(playerOf(nextState, 'c')?.hasActedThisStreet).toBe(true)
  })

  it('盲注动作由引擎控制，玩家提交被拒绝', () => {
    const state = initState(['a', 'b', 'c'])
    const actor = state.currentActor!

    const { events } = engine.applyAction(state, actor, { type: 'postSmallBlind', amount: 2 })

    expect(events[0].kind).toBe('poker/rejection')
    expect(events[0].payload.reason).toBe('blind actions are engine-controlled')
  })

  it('未知行动者被拒绝', () => {
    const state = initState(['a', 'b', 'c'])

    const { nextState, events } = engine.applyAction(state, 'ghost', { type: 'fold' })

    expect(events[0].kind).toBe('poker/rejection')
    expect(events[0].payload.reason).toBe('unknown actor')
    expect(nextState.players).toHaveLength(3)
  })

  it('动作历史按序编号并记录阶段', () => {
    let state = initState(['a', 'b', 'c'])

    state = engine.applyAction(state, state.currentActor!, { type: 'fold' }).nextState
    state = engine.applyAction(state, state.currentActor!, { type: 'fold' }).nextState

    expect(state.actionHistory).toHaveLength(2)
    expect(state.actionHistory.map((record) => record.seq)).toEqual([1, 2])
    expect(state.actionHistory.every((record) => record.phase === 'preflop')).toBe(true)
  })
})

describe('PokerEngine 街道流转', () => {
  it('翻牌前结束后发出翻牌，重置下注状态', () => {
    const preflop = initState(['a', 'b', 'c'])
    const flop = driveToStreet(preflop, 'flop')

    expect(flop.phase).toBe('flop')
    expect(flop.communityCards).toHaveLength(3)
    expect(flop.deck).toHaveLength(preflop.deck.length - 3)
    expect(flop.betsThisStreet).toBe(0)
    expect(flop.players.every((player) => player.currentBet === 0)).toBe(true)
    expect(flop.players.every((player) => !player.hasActedThisStreet)).toBe(true)
    expect(flop.streetPots.preflop).toBe(defaultConfig.smallBlind * 2 + defaultConfig.bigBlind * 2)
    // 翻牌圈从庄家下一位开始
    expect(playerOf(flop, flop.currentActor)?.seatIndex).toBe((flop.dealerIndex + 1) % 3)
  })

  it('翻牌圈下注被全员跟注后计入 flop 街池', () => {
    const flop = driveToStreet(initState(['a', 'b', 'c']), 'flop')
    const bettorState = engine.applyAction(flop, flop.currentActor!, { type: 'bet', amount: 2 }).nextState
    const turn = driveToStreet(bettorState, 'turn')

    expect(turn.phase).toBe('turn')
    expect(turn.communityCards).toHaveLength(4)
    expect(turn.streetPots.flop).toBe(6)
    expect(turn.pot).toBe(12 + 6) // 翻牌前 12 + 翻牌圈 3×2
    expect(turn.betsThisStreet).toBe(0)
  })

  it('一路 check 到河牌后摊牌结束本手', () => {
    const state = driveToStreet(initState(['a', 'b', 'c']), 'showdown')

    expect(state.phase).toBe('showdown')
    expect(state.communityCards).toHaveLength(5)
    expect(state.deck).toHaveLength(52 - 6 - 5)
    expect(state.handComplete).toBe(true)
    expect(state.currentActor).toBeNull()
    // 结算后底池清零且筹码守恒
    expect(state.pot).toBe(0)
    const totalChips = state.players.reduce((sum, player) => sum + player.chips, 0)
    expect(totalChips).toBe(defaultConfig.startingChips * 3)
    expect(state.players.every((player) => player.totalCommitted === 0)).toBe(true)
    expect(state.streetPots).toEqual({ preflop: 0, flop: 0, turn: 0, river: 0 })
  })
})
