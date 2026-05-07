import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Several API / integration tests share the same SQLite file and stub
// process.env / global.fetch. Running them in parallel workers causes
// sporadic 5s timeouts because SSE streams intersect with global fetch
// stubs from sibling files. Serialize test files but keep a single worker
// thread so the SQLite + fake-redis modules stay warm across files
// (tracked under Phase 2-2 hardening). Vitest 4 removed `test.poolOptions`
// from its public InlineConfig surface, so we build the test block with a
// loose record and let Vitest's runtime accept it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const testConfig: any = {
  globals: true,
  environment: 'jsdom',
  setupFiles: ['./tests/setup.ts'],
  exclude: ['old/**', 'node_modules/**', '.next/**'],
  pool: 'threads',
  poolOptions: {
    threads: { singleThread: true },
  },
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
  test: testConfig,
})
