'use client'

const STORAGE_KEY = 'colosseum:profile-keys'

type KeyMap = Record<string, string>

function readAll(): KeyMap {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as KeyMap) : {}
  } catch {
    return {}
  }
}

function writeAll(map: KeyMap): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
}

export const keyring = {
  get(profileId: string): string | undefined {
    return readAll()[profileId]
  },
  set(profileId: string, apiKey: string): void {
    const all = readAll()
    all[profileId] = apiKey
    writeAll(all)
  },
  remove(profileId: string): void {
    const all = readAll()
    delete all[profileId]
    writeAll(all)
  },
  all(): KeyMap {
    return readAll()
  },
  has(profileId: string): boolean {
    return !!readAll()[profileId]
  },
}
