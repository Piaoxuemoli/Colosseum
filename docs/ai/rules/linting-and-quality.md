# Lint 与质量门禁

这是一套泛用、轻量、适合重写早期的质量规则。目标是让新增代码稳定可验证，而不是用复杂基建卡住开发。

## 标准脚本

项目有 `package.json` 后，应逐步收敛到这些脚本名：

```json
{
  "scripts": {
    "bootstrap": "node scripts/dev-bootstrap.mjs",
    "sync": "node scripts/dev-sync.mjs",
    "doctor": "node scripts/dev-doctor.mjs",
    "commit:step": "node scripts/git-step-commit.mjs",
    "dev": "next dev",
    "build": "next build",
    "lint": "next lint",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "check": "npm run lint && npm run typecheck && npm test && npm run build"
  }
}
```

如果某个阶段工具尚未安装，不要伪造通过结果；记录为“当前 Phase 尚未具备运行条件”。

新设备或部署环境优先运行 `npm run bootstrap`；日常开发前运行 `npm run sync` 和 `npm run doctor`。

## ESLint 基线

推荐基线：

- Next.js 标准规则：`next/core-web-vitals`、`next/typescript`
- TypeScript 严格模式：`strict: true`
- 未使用变量报错，允许 `_arg` 形式的刻意未使用参数
- 类型导入使用 `import type`
- 禁止 `any`；确需未知输入时用 `unknown` + Zod/类型缩窄
- 禁止空 `catch`，必须记录或重新抛出
- 禁止生产代码 `console.log`，业务日志走结构化 logger；测试可例外

## TypeScript 规则

- 不用 `as any` 绕过 SDK 漂移。
- 公共函数、跨层接口、DB schema、API body/response 必须有显式类型或 Zod schema。
- React 组件 props 建议显式命名 `type XxxProps`。
- 游戏引擎层不 import React、store、Route Handler、DB、Redis、LLM SDK。

## 测试策略

- 引擎和 parser：优先单测，覆盖正常路径、非法动作、边界状态。
- Route Handler：用 Vitest 直接 import handler 做轻量集成测试。
- LLM 真调用：不进自动单测。用 mock 测逻辑，用手动 curl 验证里程碑。
- Redis/Postgres：需要容器时，测试说明前置命令；不可用时清楚记录原因。

## 提交前质量门禁

小改动至少跑相关测试；共享逻辑或跨层改动尽量跑：

```bash
npm run lint
npm run typecheck
npm test
```

Phase 里程碑完成前跑：

```bash
npm run check
```

如果 `check` 尚未配置，则按 `lint → typecheck → test → build` 顺序手动跑。

## 忽略范围

lint/typecheck 默认忽略：

- `old/**`
- `node_modules/**`
- `.next/**`
- `dist/**`
- `build/**`
- 生成的 DB migration 快照如确实不可读，可在工具层按需忽略，但不要默认忽略业务代码。
