import type { Metadata } from 'next'
import { SurfacePlayground } from '@/frontend/components/a2ui/SurfacePlayground'

export const metadata: Metadata = {
  title: 'A2UI 组件测试工具 · Colosseum',
  description: '左侧粘贴 surface JSON，右侧实时渲染 A2UI 组件。',
}

/**
 * /a2ui-playground —— A2UI 组件测试工具路由（游戏壳子）。
 * 开发期用于验证 colosseumCatalog 组件渲染；非生产观赛路径。
 */
export default function A2UIPlaygroundPage() {
  return <SurfacePlayground />
}
