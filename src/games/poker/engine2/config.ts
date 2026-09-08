// 配置解析与合法性校验（PFR-102）：非法配置在开局前结构化拒绝，绝不进入发牌。

import type { ConfigOutcome, ResolvedMatchConfig } from './types'
import { matchConfigSchema } from './types'

export function resolveConfig(input: unknown): ConfigOutcome {
  const parsed = matchConfigSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      rejection: {
        code: 'INVALID_CONFIG_SHAPE',
        message: `对局配置非法：${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
      },
    }
  }
  const cfg = parsed.data

  if (new Set(cfg.seatIds).size !== cfg.seatIds.length) {
    return { ok: false, rejection: { code: 'DUPLICATE_SEAT_ID', message: 'seatIds 存在重复' } }
  }

  if (cfg.schedule && (cfg.schedule.levels[0].sb !== cfg.blinds.sb || cfg.schedule.levels[0].bb !== cfg.blinds.bb)) {
    return {
      ok: false,
      rejection: {
        code: 'SCHEDULE_LEVEL_MISMATCH',
        message: '升级计划 levels[0] 必须与初始盲注 blinds 一致',
      },
    }
  }

  const resolved: ResolvedMatchConfig = {
    seatIds: [...cfg.seatIds],
    startingStack: cfg.startingStack,
    initialBlinds: { sb: cfg.blinds.sb, bb: cfg.blinds.bb },
    schedule: cfg.schedule ? { handsPerLevel: cfg.schedule.handsPerLevel, levels: cfg.schedule.levels.map((l) => ({ ...l })) } : null,
  }
  return { ok: true, config: resolved }
}

/** 手号（1 起）→ 盲注级索引（PFR-112/212：每 N 手升级，超出序列后停留在最后一级）。 */
export function levelForHand(config: ResolvedMatchConfig, handNumber: number): number {
  if (!config.schedule) return 0
  const idx = Math.floor((handNumber - 1) / config.schedule.handsPerLevel)
  return Math.min(idx, config.schedule.levels.length - 1)
}
