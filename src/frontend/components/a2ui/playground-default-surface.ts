/**
 * Playground 默认示例 surface —— 演示 v0.9 组件格式（扁平 props）+ 数据绑定 + 自定义组件。
 *
 * v0.9 要点（来自 @a2ui/web_core basic_catalog schemas）：
 * - 根组件 id 必须为 "root"（A2uiSurface 硬编码渲染 "root"）。
 * - 布局容器用 children: string[]（子组件 id 列表）；Card/Button 用 child: string。
 * - 数据绑定用 { path: "/xxx" }；Text.text / TextField.value 等均可绑定。
 * - schema 是 strict（多余属性会被拒），属性名须精确。
 */

import type { SurfaceDefinition } from '@/platform/core/a2ui-types'

export const DEFAULT_PLAYGROUND_SURFACE: SurfaceDefinition = {
  surfaceId: 'playground-demo',
  catalogId: 'colosseum-basic',
  root: 'root',
  components: [
    { id: 'root', component: 'Column', children: ['title', 'hint', 'params', 'picker', 'keyPanel', 'submit'] },
    { id: 'title', component: 'Text', text: 'A2UI 组件测试工具', variant: 'h3' },
    { id: 'hint', component: 'Text', text: '左侧编辑 surface JSON，右侧实时渲染。', variant: 'caption' },
    { id: 'params', component: 'Row', children: ['sb', 'bb'] },
    { id: 'sb', component: 'TextField', label: '小盲', value: { path: '/smallBlind' } },
    { id: 'bb', component: 'TextField', label: '大盲', value: { path: '/bigBlind' } },
    { id: 'picker', component: 'AgentPicker', label: '选择选手', maxCount: 6, gameType: 'poker' },
    { id: 'keyPanel', component: 'KeyCheckPanel', label: 'API Key 状态' },
    { id: 'submitLabel', component: 'Text', text: '开始对局' },
    { id: 'submit', component: 'Button', child: 'submitLabel', action: { event: { name: 'submit' } }, variant: 'primary' },
  ],
}

/** Playground 固定的数据模型默认值（演示数据绑定）。 */
export const DEFAULT_PLAYGROUND_DEFAULTS: Record<string, unknown> = {
  smallBlind: '2',
  bigBlind: '4',
}

export const DEFAULT_PLAYGROUND_TEXT = JSON.stringify(DEFAULT_PLAYGROUND_SURFACE, null, 2)
