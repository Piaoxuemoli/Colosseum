import type { Config } from 'drizzle-kit'
import { loadEnv } from './lib/env'

const env = loadEnv()

export default {
  schema: env.DB_DRIVER === 'sqlite'
    ? './lib/db/schema.sqlite.ts'
    : './lib/db/schema.pg.ts',
  out: './lib/db/migrations',
  dialect: env.DB_DRIVER === 'sqlite' ? 'sqlite' : 'postgresql',
  dbCredentials: env.DB_DRIVER === 'sqlite'
    ? { url: env.SQLITE_PATH }
    : { url: env.DATABASE_URL ?? '' },
} satisfies Config
