# 游戏包 `.a2ui/` 目录模板

新游戏接入 A2UI 声明式配置页时，在 `src/games/<game>/` 下复制本结构。
**参考实现**：`src/games/poker/.a2ui/`（德扑，已完整接入）。

## 目录结构

```
src/games/<game>/.a2ui/
├── surface/
│   └── match-config.json     # A2UI v0.9 组件树（静态，设计期手写）
├── data/
│   ├── schema.ts             # Zod 4 配置数据 schema（项目顶层 zod）
│   └── defaults.json         # 数据模型默认值
├── handle/
│   └── submit.ts             # 提交处理：校验 + 跨字段规则 + 转换 payload（= handle.sh 的 TS 版）
├── runtime/
│   └── manifest.ts           # surface 清单 + catalog 绑定
└── script/
    └── README.md             # 游戏专属构建脚本位（共享 surface 校验在项目级 scripts/a2ui/）
```

## v0.9 surface 关键规则

- 根组件 **id 必须为 `"root"`**（官方 `<A2uiSurface>` 硬编码渲染 `"root"`）。
- props **扁平**写在组件节点上（非 v0.8 的 `properties` 嵌套）。
- 布局容器用 `children: ["id1","id2"]`；`Card`/`Button` 用 `child: "id"`。
- 数据绑定用 `{ "path": "/fieldName" }`（JSON Pointer）。
- schema 是 **strict**（多余属性被拒），属性名须精确（见 `@a2ui/web_core` basic_catalog）。
- 可用组件见 `src/frontend/components/a2ui/catalog.tsx`（standard 来自 basicCatalog + `AgentPicker`/`KeyCheckPanel`）。

## 最小骨架

### surface/match-config.json

```json
{
  "surfaceId": "<game>-match-config",
  "catalogId": "colosseum-basic",
  "root": "root",
  "components": [
    { "id": "root", "component": "Column", "children": ["title", "param1", "submit"] },
    { "id": "title", "component": "Text", "text": "<游戏>对局配置", "variant": "h3" },
    { "id": "param1", "component": "TextField", "label": "参数1", "value": { "path": "/param1" } },
    { "id": "submitLabel", "component": "Text", "text": "开始对局" },
    { "id": "submit", "component": "Button", "child": "submitLabel", "action": { "event": { "name": "submit" } }, "variant": "primary" }
  ]
}
```

### data/schema.ts

```ts
import { z } from 'zod'
export const <game>ConfigSchema = z.object({
  param1: z.coerce.number().int().positive(),
})
```

### data/defaults.json

```json
{ "param1": "1" }
```

### handle/submit.ts

```ts
import type { ConfigHandle } from '@/platform/core/a2ui-types'
import { <game>ConfigSchema } from '../data/schema'

export const <game>ConfigHandle: ConfigHandle = {
  submit(data) {
    const parsed = <game>ConfigSchema.safeParse(data)
    if (!parsed.success) {
      return { ok: false, errors: parsed.error.issues.map(i => ({ path: '/' + i.path.join('/'), message: i.message })) }
    }
    return { ok: true, payload: { gameType: '<game>', engineConfig: { param1: parsed.data.param1 }, config: { agentTimeoutMs: 180000, minActionIntervalMs: 1000 } } }
  },
}
```

### runtime/manifest.ts

```ts
import type { A2UIManifest } from '@/platform/core/a2ui-types'
export const <game>ConfigManifest: A2UIManifest = { catalogId: 'colosseum-basic', surfaces: ['<game>-match-config'] }
```

## 在游戏插件注册

在 `src/games/<game>/<game>-plugin.ts` 的 `GameModule` 增加：

```ts
import type { SurfaceDefinition, SurfaceDefaults } from '@/platform/core/a2ui-types'
import matchConfigSurface from './.a2ui/surface/match-config.json'
import defaults from './.a2ui/data/defaults.json'
import { <game>ConfigSchema } from './.a2ui/data/schema'
import { <game>ConfigHandle } from './.a2ui/handle/submit'
import { <game>ConfigManifest } from './.a2ui/runtime/manifest'

// 加入 GameModule：
configSurface: matchConfigSurface as unknown as SurfaceDefinition,
configSchema: <game>ConfigSchema,
configDefaults: defaults as SurfaceDefaults,
configHandle: <game>ConfigHandle,
configManifest: <game>ConfigManifest,
```

## 校验

`node scripts/a2ui/validate-surfaces.mjs` 会遍历每个游戏的 `.a2ui/surface/*.json`，检查组件是否都在 catalog 中注册。
