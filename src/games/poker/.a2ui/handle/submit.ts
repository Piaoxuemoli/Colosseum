/**
 * 德扑配置提交处理器（原 handle.sh 的 TS 替代，spec D5）。
 * 职责：Zod 结构校验 + 跨字段规则 + 转换为 POST /api/matches 的 payload。
 */
import type { ConfigHandle } from '@/platform/core/a2ui-types'
import { pokerConfigSchema } from '../data/schema'

export const pokerConfigHandle: ConfigHandle = {
  submit(data) {
    const parsed = pokerConfigSchema.safeParse(data)
    if (!parsed.success) {
      return {
        ok: false,
        errors: parsed.error.issues.map((issue) => ({
          path: '/' + issue.path.join('/'),
          message: issue.message,
        })),
      }
    }

    const cfg = parsed.data

    // 跨字段规则：大盲不能小于小盲
    if (cfg.bigBlind < cfg.smallBlind) {
      return { ok: false, errors: [{ path: '/bigBlind', message: '大盲不能小于小盲' }] }
    }

    // 转换为 POST /api/matches 的 payload。
    // 平台级参数（agentTimeoutMs / minActionIntervalMs）由平台提供默认值；
    // keyring 由前端通用 KeyCheckPanel 收集（stub 阶段省略，旧表单仍为默认路径）。
    return {
      ok: true,
      payload: {
        gameType: 'poker',
        agentIds: cfg.agentIds,
        engineConfig: {
          smallBlind: cfg.smallBlind,
          bigBlind: cfg.bigBlind,
          startingChips: cfg.startingChips,
          maxBetsPerStreet: 4,
        },
        config: {
          agentTimeoutMs: 180_000,
          minActionIntervalMs: 1_000,
        },
      },
    }
  },
}
