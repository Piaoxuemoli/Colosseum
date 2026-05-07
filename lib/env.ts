import { existsSync, readFileSync } from 'node:fs'
import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  BASE_URL: z.string().url(),
  DB_DRIVER: z.enum(['sqlite', 'pg']),
  SQLITE_PATH: z.string().default('./dev.db'),
  DATABASE_URL: z.string().optional(),
  REDIS_URL: z.string().url(),
  MATCH_TOKEN_SECRET: z.string().optional(),
  TEST_LLM_BASE_URL: z.string().url().optional(),
  TEST_LLM_API_KEY: z.string().optional(),
  TEST_LLM_MODEL: z.string().optional(),
})

export type Env = z.infer<typeof envSchema>

function loadDotEnvFile(path = '.env') {
  if (!existsSync(path)) return

  const lines = readFileSync(path, 'utf8').split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const eq = trimmed.indexOf('=')
    if (eq < 0) continue

    const key = trimmed.slice(0, eq).trim()
    const rawValue = trimmed.slice(eq + 1).trim()
    const value = rawValue.replace(/^['"]|['"]$/g, '')

    if (key && process.env[key] === undefined) {
      process.env[key] = value
    }
  }
}

/**
 * 解析环境变量。测试中可重复调用；生产中通常只调一次并缓存。
 * 任何其他模块都必须通过 env 访问环境变量，禁止 process.env.XXX 直接读。
 */
export function loadEnv(): Env {
  loadDotEnvFile()

  const parsed = envSchema.safeParse(process.env)
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors
    const msg = Object.entries(fieldErrors)
      .map(([key, value]) => `  ${key}: ${value?.join(', ')}`)
      .join('\n')
    throw new Error(`Invalid env:\n${msg}`)
  }
  return parsed.data
}

let cached: Env | null = null

export const env: Env = (() => {
  if (cached) return cached
  cached = loadEnv()
  return cached
})()
