'use client'

import { toast } from './toast'

export type ApiError = { error: string; details?: unknown }

export type RawResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; body: ApiError }

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(init?.headers ?? {}),
      },
    })
  } catch (err) {
    // Network / abort / DNS — surface as a toast, then re-throw so callers
    // can still opt into their own UI handling.
    const msg = err instanceof Error ? err.message : 'network error'
    toast.error('网络请求失败', msg)
    throw err
  }

  if (!res.ok) {
    let body: ApiError = { error: res.statusText }
    try {
      body = (await res.json()) as ApiError
    } catch {
      // Keep the HTTP status text when the response is not JSON.
    }
    toast.error(`请求失败 · ${res.status}`, body.error)
    throw new Error(`${res.status}: ${body.error}`)
  }

  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

/**
 * Lower-level variant that returns a discriminated result instead of
 * throwing + toasting on non-2xx. Use when the UI wants to inspect a
 * structured 4xx (e.g. 409 needs-cascade) and decide what to do next.
 * Still toasts on network errors.
 */
async function requestRaw<T>(path: string, init?: RequestInit): Promise<RawResult<T>> {
  let res: Response
  try {
    res = await fetch(path, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(init?.headers ?? {}),
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'network error'
    toast.error('网络请求失败', msg)
    throw err
  }

  if (!res.ok) {
    let body: ApiError = { error: res.statusText }
    try {
      body = (await res.json()) as ApiError
    } catch {
      /* keep status-text fallback */
    }
    return { ok: false, status: res.status, body }
  }

  if (res.status === 204) return { ok: true, status: 204, data: undefined as T }
  const data = (await res.json()) as T
  return { ok: true, status: res.status, data }
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  raw: {
    del: <T>(path: string) => requestRaw<T>(path, { method: 'DELETE' }),
  },
}
