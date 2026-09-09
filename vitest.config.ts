import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['tests/setup.ts'],
  },
  // tsconfig 的 jsx: preserve（Next.js 默认）会让 .tsx 组件在 node 环境保持
  // 原始 JSX；这里经 oxc 转换器显式启用自动 JSX 运行时，供前端组件的轻量
  // 渲染断言使用（如 renderToStaticMarkup）。只影响测试转换，不触碰构建。
  oxc: {
    jsx: { runtime: 'automatic' },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
