/**
 * EMA (Exponential Moving Average) 工具函数。
 * 游戏无关的纯数学工具，用于印象平滑等场景。
 */

/**
 * 对单个数值应用 EMA 平滑。
 *
 * @param current - 当前值（undefined 表示冷启动）
 * @param raw - 新观测值
 * @param alpha - 平滑系数 (0, 1)，越大越偏向新值
 * @returns 平滑后的值
 */
export function emaSmooth(
  current: number | undefined,
  raw: number,
  alpha: number = 0.3,
): number {
  if (current === undefined) return raw
  return alpha * raw + (1 - alpha) * current
}

/** 将值 clamp 到 [min, max] 并取整 */
export function clampScore(v: number, min: number = 1, max: number = 10): number {
  return Math.max(min, Math.min(max, Math.round(v)))
}

/** 四舍五入到 1 位小数 */
export function roundScore(v: number): number {
  return Math.round(v * 10) / 10
}

/**
 * 对多维度评分对象应用 EMA 平滑。
 *
 * @param current - 当前各维度的值（key→number），冷启动时为空对象或 undefined
 * @param raw - 新观测的各维度值（key→number）
 * @param alpha - EMA 平滑系数
 * @param range - 值域 [min, max]，默认 [1, 10]
 * @returns 平滑后的各维度值
 */
export function applyMultiDimEMA(
  current: Record<string, number> | undefined,
  raw: Record<string, number>,
  alpha: number = 0.3,
  range: [number, number] = [1, 10],
): Record<string, number> {
  const result: Record<string, number> = {}
  for (const key of Object.keys(raw)) {
    const currentVal = current?.[key]
    const smoothed = currentVal === undefined
      ? clampScore(raw[key], range[0], range[1])
      : roundScore(alpha * clampScore(raw[key], range[0], range[1]) + (1 - alpha) * currentVal)
    result[key] = smoothed
  }
  return result
}
