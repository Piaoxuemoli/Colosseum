import { existsSync, unlinkSync } from 'node:fs'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'

export function resetSqliteFile(path: string) {
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    const file = `${path}${suffix}`
    if (existsSync(file)) unlinkSync(file)
  }
}

export function migrateSqliteTestDb(path: string) {
  resetSqliteFile(path)
  const sqlite = new Database(path)
  const db = drizzle(sqlite)
  migrate(db, { migrationsFolder: './lib/db/migrations' })
  sqlite.close()
}
