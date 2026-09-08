'use client'

const STORAGE_KEY = 'colosseum:profile-keys'

/**
 * 密钥状态模型（FR-4.1-03）。
 *
 * 本地 keyring 与服务端对局 keyring 采用同一 24h TTL 口径：
 * - 服务端：`backend/agent/key-cache.ts` 在每次上传时重置 24h TTL；
 * - 本地：`storedAt + KEY_TTL_MS` 视为过期参考线。本地“已过期”只代表
 *   这把 key 距上次录入超过 24h、健康度未知（可能已被吊销/轮换），
 *   不代表无法上传——上传后服务端会重新计时。
 */

/** 与服务端 match keyring 的 24h TTL 对齐。 */
export const KEY_TTL_MS = 24 * 60 * 60 * 1000
/** 距过期不足该窗口时进入「即将过期」警示态。 */
export const KEY_EXPIRING_WINDOW_MS = 2 * 60 * 60 * 1000

export type KeyStatus = 'missing' | 'ok' | 'expiring' | 'expired'

/** v2 存储条目：密钥 + 录入时间。 */
export type StoredKey = { apiKey: string; storedAt: number }
type KeyMapV2 = Record<string, StoredKey>
/** v1 遗留格式：profileId -> apiKey 明文映射。 */
type KeyMapV1 = Record<string, string>

export type MatchKeyUpload = { profileId: string; apiKey: string }

/** 纯状态推导的输入：允许缺 apiKey / storedAt（如 v1 迁移前的数据）。 */
export type KeyringEntryMeta = { apiKey?: string; storedAt?: number }
export type KeyringStatusMap = Record<string, KeyStatus>

/** 阻断级状态：开赛前必须显式确认（补充密钥或点「仍要开始」）。 */
export function isBlockingKeyStatus(status: KeyStatus): boolean {
  return status === 'missing' || status === 'expired'
}

/** 非健康状态：阻断级 + 即将过期（警示但不阻断）。 */
export function isUnhealthyKeyStatus(status: KeyStatus): boolean {
  return status !== 'ok'
}

/**
 * 单个 key 的健康状态。
 *
 * - 无 key（缺条目 / 空值）→ missing
 * - 有 key 但无 storedAt（v1 遗留）→ ok（录入时间未知，按可用处理，
 *   反正每次上传服务端都会重置 TTL）
 * - now >= storedAt + KEY_TTL_MS → expired
 * - 剩余有效期 <= KEY_EXPIRING_WINDOW_MS → expiring
 * - 其余 → ok
 */
export function keyStatusFor(entry: KeyringEntryMeta | undefined, now: number): KeyStatus {
  if (!entry || typeof entry.apiKey !== 'string' || entry.apiKey.trim().length === 0) return 'missing'
  if (typeof entry.storedAt !== 'number' || !Number.isFinite(entry.storedAt)) return 'ok'
  const expiresAt = entry.storedAt + KEY_TTL_MS
  if (now >= expiresAt) return 'expired'
  if (expiresAt - now <= KEY_EXPIRING_WINDOW_MS) return 'expiring'
  return 'ok'
}

/**
 * 纯函数：由 keyring 条目推导每个 profile 的密钥状态（FR-4.1-03）。
 * 不触碰 localStorage / Date.now，便于单测与 SSR 安全。
 */
export function keyringStatus(entries: Record<string, KeyringEntryMeta>, now: number): KeyringStatusMap {
  const out: KeyringStatusMap = {}
  for (const [profileId, entry] of Object.entries(entries)) {
    out[profileId] = keyStatusFor(entry, now)
  }
  return out
}

function parseStored(raw: string): { map: KeyMapV2; migrated: boolean } {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { map: {}, migrated: false }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { map: {}, migrated: false }
  }
  const source = parsed as KeyMapV2 | KeyMapV1
  const map: KeyMapV2 = {}
  let migrated = false
  for (const [profileId, value] of Object.entries(source)) {
    if (typeof value === 'string') {
      // v1 遗留格式：录入时间未知，迁移时以当下为 storedAt 起步计时。
      migrated = true
      if (value.length > 0) map[profileId] = { apiKey: value, storedAt: Date.now() }
      continue
    }
    if (
      typeof value === 'object' &&
      value !== null &&
      typeof (value as StoredKey).apiKey === 'string' &&
      typeof (value as StoredKey).storedAt === 'number' &&
      Number.isFinite((value as StoredKey).storedAt)
    ) {
      map[profileId] = value as StoredKey
    }
  }
  return { map, migrated }
}

function readAll(): KeyMapV2 {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const { map, migrated } = parseStored(raw)
    // v1 -> v2 迁移需要落盘，否则每次读取都会重置 storedAt 导致永不过期。
    if (migrated) writeAll(map)
    return map
  } catch {
    return {}
  }
}

function writeAll(map: KeyMapV2): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
}

export const keyring = {
  get(profileId: string): string | undefined {
    return readAll()[profileId]?.apiKey
  },
  set(profileId: string, apiKey: string): void {
    const all = readAll()
    all[profileId] = { apiKey, storedAt: Date.now() }
    writeAll(all)
  },
  remove(profileId: string): void {
    const all = readAll()
    delete all[profileId]
    writeAll(all)
  },
  all(): Record<string, string> {
    const out: Record<string, string> = {}
    for (const [profileId, entry] of Object.entries(readAll())) out[profileId] = entry.apiKey
    return out
  },
  /** v2 条目（含录入时间），供 keyringStatus 推导。 */
  entries(): KeyMapV2 {
    return readAll()
  },
  has(profileId: string): boolean {
    return !!readAll()[profileId]?.apiKey
  },
  /** 当前时刻每个本地 key 的健康状态。 */
  status(now: number = Date.now()): KeyringStatusMap {
    return keyringStatus(readAll(), now)
  },
}

export async function uploadKeysForMatch(matchId: string, entries: MatchKeyUpload[]): Promise<void> {
  await Promise.all(
    entries.map(async (entry) => {
      const res = await fetch(`/api/matches/${matchId}/keys`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(entry),
      })
      if (!res.ok) throw new Error(`上传 ${entry.profileId} 的 API Key 失败`)
    }),
  )
}
