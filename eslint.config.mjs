import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default [
  {
    ignores: [
      'old/**',
      'node_modules/**',
      '.next/**',
      'dist/**',
      'build/**',
      'next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        React: 'readonly',
        Request: 'readonly',
        Response: 'readonly',
        ReadableStream: 'readonly',
        TextDecoder: 'readonly',
        TextEncoder: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-empty': ['error', { allowEmptyCatch: false }],
    },
  },
]
