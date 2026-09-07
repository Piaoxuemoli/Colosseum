import { vi } from 'vitest'

// 单测默认纯逻辑（引擎/解析器/store），不应依赖真实 DB/Redis/LLM。
// 这里 stub 掉 env schema 的必填项，防止任何被测模块意外传递 import `@/platform/env` 时炸掉。
vi.stubEnv('NODE_ENV', 'test')
vi.stubEnv('BASE_URL', 'http://localhost:3000')
vi.stubEnv('DB_DRIVER', 'sqlite')
vi.stubEnv('SQLITE_PATH', './tmp/test.db')
vi.stubEnv('REDIS_URL', 'redis://localhost:6379')
