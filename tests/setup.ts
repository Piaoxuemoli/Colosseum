import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { ReadableStream, TransformStream, WritableStream } from 'node:stream/web'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
})

Object.assign(globalThis, {
  ReadableStream: globalThis.ReadableStream ?? ReadableStream,
  TransformStream: globalThis.TransformStream ?? TransformStream,
  WritableStream: globalThis.WritableStream ?? WritableStream,
})
