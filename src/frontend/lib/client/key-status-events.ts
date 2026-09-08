'use client'

/**
 * FR-4.1-03 错误联动：密钥类错误（ErrorBadge / SSE 侧）与
 * 对局页密钥状态浮层（KeyStatusBadge）之间的轻量通信。
 *
 * 不引入新依赖：用 CustomEvent 广播「打开密钥状态浮层」请求，
 * 让错误条目上的一键「重新上传密钥」能直接唤起浮层。
 */

const OPEN_KEY_STATUS_EVENT = 'colosseum:open-key-status'

/**
 * 密钥类错误码（与 backend/orchestrator/fallback-reasons.ts 的允许集对齐）。
 * - llm-api-key-missing：本局服务端 keyring 缺该 profile 的 key，重新上传即可修复；
 * - llm-api_error：供应商侧鉴权/额度等失败（含 key 失效），重新上传新 key 是修复路径之一。
 * 注意 llm-profile-missing 是 Profile 记录本身不存在，重传 key 无法修复，不在此列。
 */
export const KEY_RELATED_ERROR_CODES: ReadonlySet<string> = new Set(['llm-api-key-missing', 'llm-api_error'])

export function isKeyRelatedError(errorCode: string): boolean {
  return KEY_RELATED_ERROR_CODES.has(errorCode)
}

/** 请求打开对局页的密钥状态浮层（由错误条目的「重新上传密钥」触发）。 */
export function requestOpenKeyStatus(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(OPEN_KEY_STATUS_EVENT))
}

/** 监听打开请求；返回取消函数。 */
export function onOpenKeyStatus(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const listener = () => handler()
  window.addEventListener(OPEN_KEY_STATUS_EVENT, listener)
  return () => window.removeEventListener(OPEN_KEY_STATUS_EVENT, listener)
}
