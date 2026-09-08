// 分池与授予（PFR-208 贡献分层；PFR-202 平分与 TDA 奇数筹码）。

export interface Contribution {
  seatId: string
  /** 整手累计贡献（跨街累计，分层依据）。 */
  committed: number
  folded: boolean
}

export interface PotLayer {
  amount: number
  /** 该池的分池资格（贡献达层的未弃牌者）。 */
  eligibleSeatIds: string[]
}

/**
 * 贡献分层法（调研 §1.5 标准算法）：
 * 层级升序切分；弃牌者贡献保留在相应层但无任何资格；
 * 某层无有资格者时金额向外并入下一层，已是最后层则向内并入上一层。
 */
export function computePots(contributions: readonly Contribution[]): PotLayer[] {
  if (contributions.length === 0) return []
  const levels = [...new Set(contributions.filter((c) => c.committed > 0).map((c) => c.committed))].sort(
    (a, b) => a - b,
  )
  const pots: PotLayer[] = []
  let prev = 0
  let carry = 0
  for (const level of levels) {
    const contributors = contributions.filter((c) => c.committed > prev)
    if (contributors.length === 0) continue
    const layerAmount = (level - prev) * contributors.length
    const eligible = contributors.filter((c) => !c.folded).map((c) => c.seatId)
    if (eligible.length === 0) {
      carry += layerAmount
      prev = level
      continue
    }
    pots.push({ amount: layerAmount + carry, eligibleSeatIds: eligible })
    carry = 0
    prev = level
  }
  if (carry > 0) {
    if (pots.length > 0) {
      pots[pots.length - 1].amount += carry
    } else {
      pots.push({ amount: carry, eligibleSeatIds: [] })
    }
  }
  return pots
}

export interface PotWinnerShare {
  seatId: string
  baseShare: number
  oddChips: number
  total: number
}

export interface PotAwardResult {
  potIndex: number
  amount: number
  eligibleSeatIds: string[]
  winners: PotWinnerShare[]
}

/**
 * 各池独立判胜、独立平分、独立处理奇数筹码（PFR-202/208）。
 * - 单一有资格者的池直接归其（不比牌）；
 * - 奇数筹码自"按钮左侧第一个分池赢家"起顺时针逐枚分配（TDA 口径），
 *   顺序由 orderFromButton（自按钮左一起顺时针的座位序列）唯一定义，不依赖任何排序偶然性。
 */
export function awardPots(
  pots: readonly PotLayer[],
  /** 各玩家 7 张牌评估编码值；仅当池内资格者 ≥2 时使用。 */
  handValues: ReadonlyMap<string, number>,
  orderFromButton: readonly string[],
): PotAwardResult[] {
  return pots.map((pot, potIndex) => {
    const eligible = pot.eligibleSeatIds
    let winnerIds: string[]
    if (eligible.length <= 1) {
      winnerIds = [...eligible]
    } else {
      let best = -1
      for (const seatId of eligible) {
        const v = handValues.get(seatId)
        if (v === undefined) {
          throw new Error(`awardPots: 缺少 ${seatId} 的牌型值`)
        }
        if (v > best) best = v
      }
      winnerIds = eligible.filter((seatId) => handValues.get(seatId) === best)
    }

    const base = Math.floor(pot.amount / winnerIds.length)
    let remainder = pot.amount - base * winnerIds.length
    // 奇数筹码：赢家按自按钮左一的顺时针序逐枚领取
    const orderedWinners = orderFromButton.filter((seatId) => winnerIds.includes(seatId))
    const winners: PotWinnerShare[] = orderedWinners.map((seatId) => {
      const odd = remainder > 0 ? 1 : 0
      if (remainder > 0) remainder -= 1
      return { seatId, baseShare: base, oddChips: odd, total: base + odd }
    })
    return { potIndex, amount: pot.amount, eligibleSeatIds: [...eligible], winners }
  })
}
