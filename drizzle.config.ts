import type { Config } from 'drizzle-kit'
import { loadEnv } from './src/platform/env'

const env = loadEnv()

// SQLite-only in both dev and production (Phase 4+). DB_DRIVER remains in the
// env schema for forward compatibility, but no Postgres schema exists yet.
export default {
  schema: './src/platform/db/schema.sqlite.ts',
  out: './src/platform/db/migrations',
  dialect: 'sqlite' as const,
  dbCredentials: { url: env.SQLITE_PATH },
} satisfies Config
