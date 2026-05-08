import type { Config } from 'drizzle-kit'
import { loadEnv } from './lib/env'

const env = loadEnv()

// Phase 4 ships SQLite-only in production (same schema as dev). The `pg`
// branch is kept as a placeholder for a later schema migration; until we
// ship `lib/db/schema.pg.ts`, pointing DB_DRIVER=pg is unsupported.
export default (env.DB_DRIVER === 'pg'
  ? {
      schema: './lib/db/schema.pg.ts',
      out: './lib/db/migrations',
      dialect: 'postgresql' as const,
      dbCredentials: { url: env.DATABASE_URL ?? '' },
    }
  : {
      schema: './lib/db/schema.sqlite.ts',
      out: './lib/db/migrations',
      dialect: 'sqlite' as const,
      dbCredentials: { url: env.SQLITE_PATH },
    }) satisfies Config
