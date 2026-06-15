/**
 * A2UI 配置页 kill-switch（客户端）。
 *
 * `lib/env.ts` 是服务端专用（node:fs），客户端无法 import。客户端环境变量必须走
 * Next.js 的 `NEXT_PUBLIC_` 约定（构建期内联）。默认关闭（旧表单为零风险默认路径）。
 *
 * 开启方式：构建/运行时设 `NEXT_PUBLIC_A2UI_CONFIG=on`。
 * 详见 spec D8。
 */

export function isA2UIConfigEnabled(): boolean {
  return process.env.NEXT_PUBLIC_A2UI_CONFIG === 'on'
}
