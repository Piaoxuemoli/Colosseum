import type { Config } from 'drizzle-kit'
import { loadEnv } from './src/platform/env'

const env = loadEnv()

// Phase 4 ships SQLite-only in production (same schema as dev). The `pg`
// branch is kept as a placeholder for a later schema migration; until we
// ship `src/platform/db/schema.pg.ts`, pointing DB_DRIVER=pg is unsupported.
export default (env.DB_DRIVER === 'pg'
  ? {
      schema: './src/platform/db/schema.pg.ts',
      out: './src/platform/db/migrations',
      dialect: 'postgresql' as const,
      dbCredentials: { url: env.DATABASE_URL ?? '' },
    }
  : {
      schema: './src/platform/db/schema.sqlite.ts',
      out: './src/platform/db/migrations',
      dialect: 'sqlite' as const,
      dbCredentials: { url: env.SQLITE_PATH },
    }) satisfies Config
