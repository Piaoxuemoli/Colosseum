export interface RpcRequest {
  jsonrpc: '2.0'
  id: number | string
  method: string
  params?: unknown
}

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: number; message: string } }

export function parseRpcRequest(raw: unknown): ParseResult<RpcRequest> {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: { code: -32700, message: 'parse error' } }
  }
  const o = raw as Record<string, unknown>
  if (o.jsonrpc !== '2.0') {
    return { ok: false, error: { code: -32600, message: 'invalid request' } }
  }
  if (typeof o.method !== 'string') {
    return { ok: false, error: { code: -32600, message: 'missing method' } }
  }
  if (o.id === undefined) {
    return { ok: false, error: { code: -32600, message: 'missing id' } }
  }
  return {
    ok: true,
    value: {
      jsonrpc: '2.0',
      id: o.id as number | string,
      method: o.method,
      params: o.params,
    },
  }
}

export function rpcError(
  id: number | string | null,
  code: number,
  message: string,
  data?: unknown,
) {
  return {
    jsonrpc: '2.0' as const,
    id,
    error: data !== undefined ? { code, message, data } : { code, message },
  }
}

export function rpcResult(id: number | string, result: unknown) {
  return { jsonrpc: '2.0' as const, id, result }
}

export const RpcErrors = {
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
  UNAUTHORIZED: -32001,
} as const
