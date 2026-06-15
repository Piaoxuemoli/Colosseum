#!/usr/bin/env node
/**
 * Surface 构建期校验器：遍历每个游戏包 .a2ui 目录下的 surface JSON，
 * 检查每个组件的 `component` 是否都在 colosseumCatalog 中注册，且 surface 含 id:"root" 根组件。
 *
 * 用法：node scripts/a2ui/validate-surfaces.mjs
 * 退出码：0 通过，1 有失败。
 *
 * 注意：ALLOWED 列表须与 src/frontend/components/a2ui/catalog.tsx 的 colosseumComponentNames 保持同步。
 */
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

// 允许的组件名（= basicCatalog 标准件 + 项目自定义件）
const ALLOWED = new Set([
  // basicCatalog standard（来自 @a2ui/web_core/v0_9 basic_catalog）
  'Text', 'Image', 'Icon', 'Video', 'AudioPlayer',
  'Row', 'Column', 'List', 'Card', 'Tabs', 'Divider', 'Modal',
  'Button', 'TextField', 'CheckBox', 'ChoicePicker', 'Slider', 'DateTimeInput',
  // colosseum 自定义
  'AgentPicker', 'KeyCheckPanel',
])

const GAMES_DIR = 'src/games'

async function* walk(dir) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      yield* walk(p)
    } else if (e.isFile() && p.replace(/\\/g, '/').includes('/.a2ui/surface/') && p.endsWith('.json')) {
      yield p
    }
  }
}

let failures = 0
let componentCount = 0
let fileCount = 0

const { readFile } = await import('node:fs/promises')

for await (const file of walk(GAMES_DIR)) {
  fileCount++
  const text = await readFile(file, 'utf8')
  let surf
  try {
    surf = JSON.parse(text)
  } catch (e) {
    console.error(`✗ ${file}: JSON 解析失败 - ${e.message}`)
    failures++
    continue
  }
  const comps = Array.isArray(surf.components) ? surf.components : []
  if (!comps.some((c) => c && c.id === 'root')) {
    console.error(`✗ ${file}: 缺少 id:"root" 的根组件`)
    failures++
  }
  for (const c of comps) {
    componentCount++
    const name = c && typeof c === 'object' ? c.component : undefined
    if (!name || !ALLOWED.has(name)) {
      console.error(`✗ ${file}: 未注册组件 "${name}" (id=${c && c.id})`)
      failures++
    }
  }
  console.log(`✓ ${file}: ${comps.length} 组件`)
}

if (failures > 0) {
  console.error(`\n${failures} 项校验失败（${fileCount} 文件 / ${componentCount} 组件）`)
  process.exit(1)
}
console.log(`\n所有 surface 校验通过（${fileCount} 文件 / ${componentCount} 组件）`)
