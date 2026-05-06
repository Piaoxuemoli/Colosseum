import Database from 'better-sqlite3'
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3'
import { loadEnv } from '@/lib/env'
import * as sqliteSchema from './schema.sqlite'

const env = loadEnv()

/**
 * 单例 Drizzle 数据库实例。Phase 0 仅支持 SQLite；Phase 4 补 Postgres 分支。
 */
export const db = (() => {
  if (env.DB_DRIVER === 'sqlite') {
    const sqlite = new Database(env.SQLITE_PATH)
    sqlite.pragma('journal_mode = WAL')
    return drizzleSqlite(sqlite, { schema: sqliteSchema })
  }

  throw new Error(`DB_DRIVER=${env.DB_DRIVER} not implemented in Phase 0`)
})()

export type DB = typeof db
