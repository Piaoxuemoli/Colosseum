// 测试夹具：内存 SQLite + 仓库真实迁移文件建库。
//
// 直接 exec src/platform/db/migrations/*.sql（statement-breakpoint 是 SQL
// 注释，better-sqlite3 可整段执行）——顺带验证迁移链在空库上可干净应用。

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import type { DB } from '@/platform/db/client'
import * as schema from '@/platform/db/schema.sqlite'

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../../src/platform/db/migrations', import.meta.url))

export function createTestDb(): DB {
  const sqlite = new Database(':memory:')
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()
  for (const name of files) {
    sqlite.exec(readFileSync(join(MIGRATIONS_DIR, name), 'utf-8'))
  }

  return drizzle(sqlite, { schema }) as unknown as DB
}
