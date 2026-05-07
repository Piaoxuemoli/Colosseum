import { describe, expect, it } from 'vitest'
import { parseRpcRequest, rpcError, rpcResult, RpcErrors } from '@/lib/a2a-core/jsonrpc'

describe('parseRpcRequest', () => {
  it('parses valid request', () => {
    const r = parseRpcRequest({ jsonrpc: '2.0', id: 1, method: 'message/stream', params: {} })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.method).toBe('message/stream')
  })

  it('rejects null / non-object', () => {
    expect(parseRpcRequest(null).ok).toBe(false)
    expect(parseRpcRequest('nope').ok).toBe(false)
  })

  it('rejects missing jsonrpc field', () => {
    const r = parseRpcRequest({ id: 1, method: 'x' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe(-32600)
  })

  it('rejects wrong version', () => {
    const r = parseRpcRequest({ jsonrpc: '1.0', id: 1, method: 'x' })
    expect(r.ok).toBe(false)
  })

  it('rejects missing method', () => {
    const r = parseRpcRequest({ jsonrpc: '2.0', id: 1 })
    expect(r.ok).toBe(false)
  })

  it('rejects missing id', () => {
    const r = parseRpcRequest({ jsonrpc: '2.0', method: 'x' })
    expect(r.ok).toBe(false)
  })
})

describe('rpcError / rpcResult', () => {
  it('error envelope (no data)', () => {
    expect(rpcError(7, RpcErrors.METHOD_NOT_FOUND, 'method not found')).toEqual({
      jsonrpc: '2.0',
      id: 7,
      error: { code: -32601, message: 'method not found' },
    })
  })

  it('error envelope (with data)', () => {
    const e = rpcError(8, -32001, 'unauthorized', { reason: 'bad token' })
    expect(e.error).toEqual({ code: -32001, message: 'unauthorized', data: { reason: 'bad token' } })
  })

  it('result envelope', () => {
    expect(rpcResult(9, { ok: true })).toEqual({ jsonrpc: '2.0', id: 9, result: { ok: true } })
  })
})
