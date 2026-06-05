import '@testing-library/jest-dom/vitest'
import { ReadableStream, TransformStream, WritableStream } from 'node:stream/web'

Object.assign(globalThis, {
  ReadableStream: globalThis.ReadableStream ?? ReadableStream,
  TransformStream: globalThis.TransformStream ?? TransformStream,
  WritableStream: globalThis.WritableStream ?? WritableStream,
})
