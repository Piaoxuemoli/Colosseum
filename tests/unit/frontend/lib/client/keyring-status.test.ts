import { describe, expect, it } from 'vitest'
import {
  KEY_EXPIRING_WINDOW_MS,
  KEY_TTL_MS,
  isBlockingKeyStatus,
  isUnhealthyKeyStatus,
  keyStatusFor,
  keyringStatus,
  type KeyringEntryMeta,
} from '@/frontend/lib/client/keyring'

/**
 * FR-4.1-03 密钥健康状态的纯函数口径：
 *   missing   无 key（缺条目 / 空值）
 *   ok        有 key 且距过期还有充足时间（> 2h）
 *   expiring  剩余有效期 <= 2h（含恰好 2h）
 *   expired   now >= storedAt + 24h TTL（含恰好到期）
 * 本地 TTL 与服务端 match keyring 的 24h 对齐（backend/agent/key-cache.ts）。
 * 夹具统一经 entry() 构造，避免测试代码里出现凭据形态的字面量。
 */

const NOW = 1_800_000_000_000 // 固定基准时刻，避免用例间漂移
const HOUR = 60 * 60 * 1000

function entry(secret: string, storedAt?: number): KeyringEntryMeta {
  return storedAt === undefined ? { apiKey: secret } : { apiKey: secret, storedAt }
}

const fresh = entry('fixture-fresh', NOW - 1 * HOUR)
const nearExpiry = entry('fixture-near', NOW - (KEY_TTL_MS - 1 * HOUR))

describe('keyStatusFor 边界口径', () => {
  it('无条目 → missing', () => {
    expect(keyStatusFor(undefined, NOW)).toBe('missing')
  })

  it('apiKey 为空串或纯空白 → missing', () => {
    expect(keyStatusFor(entry('', NOW), NOW)).toBe('missing')
    expect(keyStatusFor(entry('   ', NOW), NOW)).toBe('missing')
    expect(keyStatusFor({ storedAt: NOW }, NOW)).toBe('missing')
  })

  it('新录入（远未到 2h 窗口）→ ok', () => {
    expect(keyStatusFor(fresh, NOW)).toBe('ok')
  })

  it('恰好剩余 2h（进入窗口边界）→ expiring', () => {
    const e = entry('fixture-edge', NOW - (KEY_TTL_MS - KEY_EXPIRING_WINDOW_MS))
    expect(keyStatusFor(e, NOW)).toBe('expiring')
  })

  it('剩余 2h + 1ms（窗口外边界）→ ok', () => {
    const e = entry('fixture-edge', NOW - (KEY_TTL_MS - KEY_EXPIRING_WINDOW_MS - 1))
    expect(keyStatusFor(e, NOW)).toBe('ok')
  })

  it('剩余 1h（窗口内）→ expiring', () => {
    expect(keyStatusFor(nearExpiry, NOW)).toBe('expiring')
  })

  it('恰好到达 TTL → expired', () => {
    const e = entry('fixture-edge', NOW - KEY_TTL_MS)
    expect(keyStatusFor(e, NOW)).toBe('expired')
  })

  it('超过 TTL（含 1ms）→ expired', () => {
    const e = entry('fixture-old', NOW - KEY_TTL_MS - 1)
    expect(keyStatusFor(e, NOW)).toBe('expired')
  })

  it('v1 遗留条目（无 storedAt）→ 按可用处理（ok）', () => {
    expect(keyStatusFor(entry('fixture-legacy'), NOW)).toBe('ok')
    expect(keyStatusFor(entry('fixture-legacy', Number.NaN), NOW)).toBe('ok')
  })
})

describe('keyringStatus 多 Profile 推导', () => {
  it('混合阵容：每个 Profile 独立推导', () => {
    const entries: Record<string, KeyringEntryMeta> = {
      profile_ok: entry('a', NOW - 1 * HOUR),
      profile_expiring: entry('b', NOW - (KEY_TTL_MS - 30 * 60 * 1000)),
      profile_expired: entry('c', NOW - (KEY_TTL_MS + 5 * 60 * 1000)),
      profile_missing: {},
    }
    expect(keyringStatus(entries, NOW)).toEqual({
      profile_ok: 'ok',
      profile_expiring: 'expiring',
      profile_expired: 'expired',
      profile_missing: 'missing',
    })
  })

  it('空 keyring → 全部 missing', () => {
    expect(keyringStatus({}, NOW)).toEqual({})
  })

  it('同一 Profile 随时间从 ok → expiring → expired 演进', () => {
    const storedAt = NOW - 5 * HOUR
    // 存入后 5h：距 24h TTL 还有 19h → ok
    expect(keyStatusFor(entry('fixture-flow', storedAt), NOW)).toBe('ok')
    // 存入后 23h（剩余 1h）→ expiring
    expect(keyStatusFor(entry('fixture-flow', storedAt), NOW + 18 * HOUR)).toBe('expiring')
    // 存入后 24.5h → expired
    expect(keyStatusFor(entry('fixture-flow', storedAt), NOW + 19.5 * HOUR)).toBe('expired')
  })
})

describe('阻断 / 警示分级', () => {
  it('missing 与 expired 阻断，ok / expiring 不阻断', () => {
    expect(isBlockingKeyStatus('missing')).toBe(true)
    expect(isBlockingKeyStatus('expired')).toBe(true)
    expect(isBlockingKeyStatus('ok')).toBe(false)
    expect(isBlockingKeyStatus('expiring')).toBe(false)
  })

  it('非健康 = 阻断级 + 即将过期', () => {
    expect(isUnhealthyKeyStatus('ok')).toBe(false)
    expect(isUnhealthyKeyStatus('expiring')).toBe(true)
    expect(isUnhealthyKeyStatus('expired')).toBe(true)
    expect(isUnhealthyKeyStatus('missing')).toBe(true)
  })
})
