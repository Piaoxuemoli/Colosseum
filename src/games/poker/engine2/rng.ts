// 受控随机性（PFR-404 / PFR-601）：
// - 全部随机性由种子派生：masterSeed（由外部种子哈希）→ 每手 handSeed；
// - 生成器为 mulberry32（32 位整数运算，跨平台确定性）；
// - 引擎外不存在第二随机源（不使用 Math.random）。

export type RngSeed = number | string

/** 返回 [0, 2^32) 无符号整数的确定性生成器。 */
export type Rng = () => number

export function mix32(input: number): number {
  let z = input | 0
  z = (z + 0x9e3779b9) | 0
  let t = z ^ (z >>> 16)
  t = Math.imul(t, 0x21f0aaad)
  t = t ^ (t >>> 15)
  t = Math.imul(t, 0x735a2d97)
  return (t ^ (t >>> 15)) >>> 0
}

/** 字符串种子 → 32 位 master 种子（FNV-1a + 终态混合）；数值种子直接混合。 */
export function hashSeed(seed: RngSeed): number {
  if (typeof seed === 'number') {
    return mix32(Math.trunc(seed))
  }
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    h = (h ^ seed.charCodeAt(i)) >>> 0
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return mix32(h)
}

export function mulberry32(seed: number): Rng {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = a ^ (a >>> 15)
    t = Math.imul(t, 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return (t ^ (t >>> 14)) >>> 0
  }
}

/** 每手独立派生的洗牌种子（masterSeed + 手号），支持单手单独复现。 */
export function handSeedFrom(masterSeed: number, handNumber: number): number {
  return mix32((masterSeed ^ Math.imul(handNumber, 0x9e3779b9)) | 0)
}

/** 首手按钮位：由 masterSeed 受控派生（PFR-102 / PFR-404）。 */
export function firstButtonSeat(masterSeed: number, seatCount: number): number {
  const rng = mulberry32(mix32(masterSeed ^ 0x5bd1e995))
  return Math.floor((rng() / 4294967296) * seatCount)
}

/** Fisher–Yates 洗牌（确定性、无偏）。 */
export function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor((rng() / 4294967296) * (i + 1))
    const tmp = out[i]
    out[i] = out[j]
    out[j] = tmp
  }
  return out
}
