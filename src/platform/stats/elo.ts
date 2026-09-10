/**
 * FR-4.9-01 ELO 天梯纯函数（公平性口径见 PRD §4.9 七条代决）。
 *
 * - 品类分列由调用方保证（每 gameType 一张评分表）；本模块只算一场对局。
 * - 多人局零和两两更新：仅跨阵营配对计分（阵营内不分高下），
 *   delta_i = K × Σ_j(S_ij − E_ij) / (n−1)——Σ delta 恒为 0（守恒）。
 * - 平局 / 不可判定局由调用方跳过（本模块只接收已判定的 win/lose）。
 * - 幂等重建：rebuildEloLadder 以空表重放按时间升序的全部对局。
 */

export const ELO_INITIAL = 1000
export const ELO_K = 32

export type EloPlayerInput = {
  agentId: string
  won: boolean
}

export type EloState = {
  rating: number
  matchesPlayed: number
  wins: number
  losses: number
  lastDelta: number
}

export function initialEloState(): EloState {
  return { rating: ELO_INITIAL, matchesPlayed: 0, wins: 0, losses: 0, lastDelta: 0 }
}

/** 标准期望胜率：E(a, b) = 1 / (1 + 10^((b − a) / 400))。 */
export function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / 400))
}

/**
 * 一场对局的评分更新（纯函数）。
 *
 * @param players 参赛者（胜负已按 FR-4.6-05 同源口径判定）
 * @param states 当前评分表（缺项视为初始分）；不会被原地修改
 * @returns 更新后的评分表（新 Map）与本次变动的逐选手 delta
 */
export function applyEloMatch(
  players: EloPlayerInput[],
  states: ReadonlyMap<string, EloState>,
): { states: Map<string, EloState>; deltas: Map<string, number> } {
  const next = new Map(states)
  for (const player of players) {
    if (!next.has(player.agentId)) next.set(player.agentId, initialEloState())
  }

  const rating = (agentId: string): number => next.get(agentId)?.rating ?? ELO_INITIAL
  // 零和原始分：raw_i = Σ_{j 跨阵营} (S_ij − E_ij)。全体求和恒为 0。
  const raw = new Map<string, number>(players.map((player) => [player.agentId, 0]))
  for (const self of players) {
    for (const other of players) {
      if (self.agentId === other.agentId || self.won === other.won) continue
      const expected = expectedScore(rating(self.agentId), rating(other.agentId))
      const actual = self.won ? 1 : 0
      raw.set(self.agentId, (raw.get(self.agentId) ?? 0) + (actual - expected))
    }
  }

  const divisor = Math.max(1, players.length - 1)
  const deltas = new Map<string, number>()
  for (const player of players) {
    const delta = Math.round(((raw.get(player.agentId) ?? 0) * ELO_K) / divisor)
    deltas.set(player.agentId, delta)
    const state = next.get(player.agentId) ?? initialEloState()
    next.set(player.agentId, {
      rating: state.rating + delta,
      matchesPlayed: state.matchesPlayed + 1,
      wins: state.wins + (player.won ? 1 : 0),
      losses: state.losses + (player.won ? 0 : 1),
      lastDelta: delta,
    })
  }
  return { states: next, deltas }
}

/**
 * 幂等重建：以初始空表重放按时间升序排列的对局序列。
 * 同一批输入任意次重放结果逐分一致（FR-4.9-01 验收）。
 */
export function rebuildEloLadder(matches: EloPlayerInput[][]): Map<string, EloState> {
  let states = new Map<string, EloState>()
  for (const players of matches) {
    states = applyEloMatch(players, states).states
  }
  return states
}
