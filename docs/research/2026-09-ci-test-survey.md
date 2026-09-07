# 2026-09 测试与 CI 基建调研：高星 npm/Node 仓库实践与 Colosseum 落地建议

- 调研日期：2026-09-07
- 调研方式：直接读取各仓库 GitHub 上的 `.github/workflows/*`、根 `package.json`、测试配置文件（jest.config / vitest.config），辅以官方博客与 npm registry 版本核查。所有一手数据均在 2026-09-07 从对应仓库默认分支抓取。
- 目的：Colosseum 旧 Vitest 套件（98 文件 / 399 测试）已刻意清空，`npm test` 目前是占位脚本，仓库内没有 `.github/workflows/`。本报告调研同类高星仓库的测试与 CI 惯例，为重建"工程代码与测试代码相互独立"的测试 + CI 体系给出可执行方案。

---

## TL;DR

1. **7 个被调研仓库中 6 个用 Vitest**（zustand / trpc / drizzle-orm / vercel/ai / zod / shadcn-ui），只有 vercel/next.js 仍在 Jest 上（历史包袱 + 自研分片基建）。2026 年社区共识：Next 15 + React 19 项目选 Vitest，Jest 对 React 19 ESM/CJS 互操作有兼容性问题，Next.js 官方文档也已提供 Vitest 指南。
2. **版本现状**：Vitest 4.0（2025-10-22）把 Browser Mode 转为稳定；4.1（2026-03-12）强化 Playwright Trace 集成；**5.0 已于 2026-09-03 发布**（4 天前）。被调研仓库全部停留在 4.0~4.1.x。建议 Colosseum 起步用 `vitest@^4.1`（生态验证最充分），下个季度再评估升 5。
3. **测试位置**：单包库的主流是"顶层独立 `tests/`"（zustand）或"包内 `tests/` 目录"（drizzle、trpc）；monorepo 应用层则常见共置 `*.test.ts`（vercel/ai）。对 Colosseum 的"工程和测试独立"诉求，**顶层 `tests/unit/` + `tests/e2e/`，`src/` 零测试文件**是最贴合且先例充分的选择。
4. **CI 结构**：中小仓库用**单个 `ci.yml`**（zustand 模式：format/types/lint/spec/build 顺序跑在一个 job）；大仓库拆多 workflow + 路径过滤 + 矩阵 + 分片。通用最佳实践已成标配：`permissions: contents: read`、`concurrency` 取消旧运行、job 级 `timeout-minutes`、action 按 SHA 固定、npm/pnpm 缓存。
5. **覆盖率**：7 仓中无一强制全局阈值。trpc 用 istanbul + Codecov（`fail_ci_if_error: true`）；zustand 用 v8 只出报告不设阈值；vercel/ai 反而用 **bundle-size 预算**约束。建议 Colosseum：v8 覆盖率、先报告后阈值、阈值只作用于 `games/**` 引擎等核心纯逻辑。
6. **落地节奏**：Phase A 先上无测试的 CI（lint/typecheck/build，Node 22）→ Phase B 恢复引擎/解析器单测 → Phase C Playwright E2E 观赛 UI。`check:werewolf` 闭环需要真实 LLM key，不进 PR 必检，放独立夜间/手动 workflow。

---

## 1. 调研背景与范围

### 1.1 Colosseum 现状（与本报告相关的部分）

- 技术栈：Next.js 15（App Router）+ React 19 + TS 5.9 + ESLint 10（flat config）+ Tailwind 4；数据层 Drizzle + better-sqlite3，可选 Redis（ioredis / Upstash）；zustand、zod 4、Vercel AI SDK 5、@a2a-js/sdk。
- 包管理：npm（单包，非 monorepo）。
- 当前质量门禁：`npm run check` = `check:surfaces` → `eslint .` → `tsc --noEmit` → `next build`。（2026-09-07 重建时旧的 `check:werewolf` / `check:werewolf-ui` tsx 闭环脚本已随测试清空删除；若采纳 §6.4/§7 的 nightly 建议，可从 git 历史复活其逻辑并改造为正式验收测试。）
- `npm test` / `npm test:watch` 为占位 echo；无 `.github/workflows/`。
- Node：生产钉在 22（`.nvmrc`），本地开发用 25。
- 游戏逻辑集中在 `src/games/{poker,werewolf}`（engine/agent/memory/ui 子目录），属于纯逻辑、最适合先恢复单测的部分。

### 1.2 选仓标准

优先挑选与上述栈直接相关（被依赖或同类 Next.js 应用）、社区公认度高、CI 演进活跃的仓库。最终 7 仓：

| 仓库 | Stars（2026-09-07） | 与 Colosseum 的关系 |
|---|---|---|
| [vercel/next.js](https://github.com/vercel/next.js) | ~142k | 框架本体；测试目录组织与 CI 规模化技巧的参照 |
| [shadcn-ui/ui](https://github.com/shadcn-ui/ui) | ~123k | 最接近的"Next.js 应用 + 组件库"混合体；dev-server 驱动的集成测试 |
| [pmndrs/zustand](https://github.com/pmndrs/zustand) | ~59k | 直接依赖；单包库的极简 CI 范本 |
| [colinhacks/zod](https://github.com/colinhacks/zod) | ~44k | 直接依赖；TS 版本矩阵测试 |
| [trpc/trpc](https://github.com/trpc/trpc) | ~41k | 同类全栈 TS RPC；覆盖率 + E2E 矩阵最完整 |
| [drizzle-team/drizzle-orm](https://github.com/drizzle-team/drizzle-orm) | ~36k | 直接依赖；多数据库集成测试分片范本 |
| [vercel/ai](https://github.com/vercel/ai) | ~27k | 直接依赖（AI SDK 5）；路径过滤 + 矩阵 + 门禁聚合 job 范本 |

---

## 2. 总览表

| 仓库 | 测试运行器 | 测试位置 | CI 主入口 | Node 版本 | 覆盖率策略 |
|---|---|---|---|---|---|
| vercel/next.js | Jest 29.7 + jest-environment-jsdom（另装 Playwright 1.61 驱动浏览器用例） | 顶层 `test/`（jest `rootDir: 'test'`，含 unit/integration/e2e 编号目录）+ 部分共置于 `packages/next` | `build_and_test.yml`（另有 33 个 workflow） | 20（维护）/ 22（LTS） | 无阈值；jest-junit 报告 + 基于历史耗时的自动分片 |
| shadcn-ui/ui | Vitest 3.2.6（包内）+ Playwright Chromium（浏览器测试）+ `start-server-and-test` | 包内测试（`packages/react`、`packages/helpers`、CLI 包）；`apps/v4` 经 dev server 跑 registry 集成测试 | `test.yml`（3 job）+ `browser-tests.yml` + `code-check.yml` | 22（test）/ 20（browser） | 无 |
| pmndrs/zustand | Vitest ^4.1.10 + jsdom + @vitest/coverage-v8 | **顶层 `tests/`**（含 `setup.ts`）；覆盖率只统计 `src/**` | `test.yml`（单 job 串行跑全部检查）+ 多版本矩阵 workflow | `lts/*` | coverage-v8，多 reporter，无阈值 |
| colinhacks/zod | Vitest ^4.1.5（自定义 `nub exec` 包装） | 包内 `src/v4/classic/tests/` 等 `tests/` 子目录 | `test.yml` | `lts/*`（test）/ latest（lint） | 无 |
| trpc/trpc | Vitest ^4.0.18（workspace projects）+ @vitest/coverage-istanbul + Testing Library；examples 内用 Playwright | 每包 `packages/*/test/`，根配置 `projects: ['./packages/*']` | `main.yml` + `lint.yml` 等 | 默认最新 + 18/20 legacy 矩阵 | istanbul + Codecov，`fail_ci_if_error: true` |
| drizzle-team/drizzle-orm | Vitest（turbo `test` 任务下发到各包） | 每包 `tests/` + 顶层 `integration-tests/` 包 | `router.yaml` → `release-feature-branch.yaml`（17 分片矩阵） | 20.19（test）/ 22（attw）/ 24（release） | 无 |
| vercel/ai | Vitest 4.1.6（node/edge 双环境）+ Playwright ^1.61.1（RSC E2E） | **共置** `packages/*/src/**/*.test.ts` + `.test-d.ts` 类型测试 | `ci.yml`（矩阵 + 分片 + 门禁 job） | 22（默认）/ 24（Windows）/ 22·24·26（test 矩阵） | 无覆盖率阈值；bundle-size 预算检查 |

---

## 3. 各仓库详情

### 3.1 vercel/next.js —— Jest 存量 + 规模化 CI 的天花板

- 仓库：<https://github.com/vercel/next.js>（默认分支 `canary`）
- **运行器**：Jest 29.7（`test: "scripts/run-jest.sh --bundler=webpack --headless"`），同时安装 Playwright 1.61 驱动需要真实浏览器的用例。选 Jest 是历史原因——整套 `run-tests.js` 基建（按历史耗时切分、JUnit 报告、按 bundler 矩阵重跑）都长在 Jest 上。**对新项目不具可迁移性**，但其组织方式值得借鉴。
- **测试位置**：`jest.config.js` 设 `rootDir: 'test'`，即**顶层独立 `test/` 目录**（编号目录 + `test/unit/`），另有 roots 指向 `packages/next` 等源码目录跑共置测试——混合模式。
- **CI 结构**（[build_and_test.yml](https://github.com/vercel/next.js/blob/canary/.github/workflows/build_and_test.yml)，共 34 个 workflow 文件）：
  - 触发：push canary + PR；**`changes` job 做路径过滤**（docs-only 跳过大部分 job）。
  - 主体复用 `build_reusable.yml`（reusable workflow + `secrets: inherit`）。
  - `fetch-test-timings` job 预热 pnpm store 并写出测试耗时文件，供按耗时均衡分片。
  - 自定义 ARM/x86/Windows runner；`NODE_MAINTENANCE_VERSION: 20`、`NODE_LTS_VERSION: 22`——**Next.js 官方仓的 LTS 锚点就是 22**，与 Colosseum 生产一致。
  - concurrency：PR 按 ref 分组取消旧运行，push 按 commit SHA 分组不取消。
- **覆盖率**：无阈值。用 jest-junit（条件启用 `NEXT_JUNIT_TEST_REPORT`）产出报告。
- **值得抄的点**：docs-only 路径过滤省 CI；耗时驱动的分片思路（Colosseum 规模用不上，但知道天花板在哪）；push 与 PR 用不同 concurrency key。

### 3.2 pmndrs/zustand —— 单包库的极简范本（最值得 Colosseum 直接模仿）

- 仓库：<https://github.com/pmndrs/zustand>
- **运行器**：Vitest ^4.1.10 + jsdom（`globals: true` 配合 Testing Library 自动清理）+ `@vitest/coverage-v8`、`@vitest/eslint-plugin`。脚本四件套：`test:spec`（vitest run）/ `test:types`（tsc --noEmit）/ `test:lint` / `test:format`。
- **测试位置**：**顶层 `tests/` 目录**（`vitest.config.mts` 里 `dir: 'tests'`，setup 在 `tests/setup.ts`），`src/` 完全干净；覆盖率 `include: 'src/**'`。别名把 `zustand` 映射回 `./src/index.ts`，测试直接吃 TS 源码——与 Colosseum 想要的"工程/测试独立"完全同构。
- **CI 结构**（[test.yml](https://github.com/pmndrs/zustand/blob/main/.github/workflows/test.yml)）：单 job、ubuntu-latest、Node `lts/*`、pnpm 缓存，按序跑 format → types → lint → spec → build（注释直言"没有别的 workflow 测 build，所以在这测"）。另有：
  - `test-multiple-versions.yml`：**React 版本矩阵**（18.0~19.2 + canary/experimental，`fail-fast: false`）；
  - `test-old-typescript.yml` / `test-multiple-builds.yml`。
- **安全细节**（2026 年的标配，值得逐条照抄）：`permissions: contents: read`；action 按 commit SHA 固定（`actions/checkout@v6.0.2` 等）；`persist-credentials: false`。
- **覆盖率**：v8 provider，reporter 为 text/json/html/text-summary，CI 下追加 `github-actions` reporter（在 PR 里内联注释），**无阈值**。
- **未做**：workflow 无 concurrency（已知短板，Colosseum 应补上）。

### 3.3 shadcn-ui/ui —— Next.js 应用 + 浏览器测试的混合打法

- 仓库：<https://github.com/shadcn-ui/ui>
- **运行器**：Vest 3.2.6（包内：`@shadcn/react`、`@shadcn/helpers`、CLI 包）+ Playwright Chromium（浏览器测试）+ `start-server-and-test`（拉起 `v4:dev` dev server 后跑 turbo test，属于"真 dev server 集成测试"）。
- **测试位置**：包内测试目录；`apps/v4`（Next.js 站点）本体几乎无单测，靠 registry 构建后的 dev-server 集成测试兜底。
- **CI 结构**：
  - [test.yml](https://github.com/shadcn-ui/ui/blob/main/.github/workflows/test.yml)：3 个 job（root `pnpm test` / `--filter=@shadcn/react` / `--filter=@shadcn/helpers`），Node 22，pnpm store 用 `actions/cache`（key 绑定 lockfile 哈希 + restore-keys）。
  - [browser-tests.yml](https://github.com/shadcn-ui/ui/blob/main/.github/workflows/browser-tests.yml)：**路径过滤**（仅 `packages/react/**` 或 workflow 自身变更才跑），装 Playwright Chromium `--with-deps`，并**缓存 `~/.cache/ms-playwright`**（按 lockfile 哈希）——浏览器二进制缓存是 E2E 提速的关键。
  - `code-check.yml` 做 lint/typecheck。
- **覆盖率**：无。
- **值得抄的点**：浏览器测试独立 workflow + 路径过滤 + 浏览器缓存；用 `start-server-and-test` 把"构建产物 + dev server"纳入被测系统。**反面教材**：action 还停在 v3/v4 旧 tag、无 concurrency、无 timeout——大仓库也会有欠账，不必等完美再上 CI。

### 3.4 colinhacks/zod —— 版本矩阵与循环依赖检查

- 仓库：<https://github.com/colinhacks/zod>
- **运行器**：Vitest ^4.1.5（`nub exec --node vitest run` 包装），另有 `vitest.compile.config.ts` 做编译期测试；typecheck 检查 `**/*.test.ts`。
- **测试位置**：包内 `tests/` 子目录（如 `packages/zod/src/v4/classic/tests/`），`projects: ["packages/*"]`。
- **CI 结构**（[test.yml](https://github.com/colinhacks/zod/blob/main/.github/workflows/test.yml)）：三个 job——
  - `test-node`：**TypeScript 版本矩阵**（5.5 / 6 / latest，`fail-fast: false`）+ 集成包测试；
  - `lint`：format:check + lint:check + 注释规范检查；
  - `check-circular`：循环依赖检查（独立 job）。
- **覆盖率**：无。**未做**：无缓存、无 concurrency——是 7 仓中 CI 卫生最差的，反衬这些基础项的价值。
- **值得抄的点**：把"依赖方版本兼容"做成矩阵（对 Colosseum 而言可类比为未来 Node 22/24 矩阵）；把非测试的一致性检查（循环依赖）也纳入 CI。

### 3.5 trpc/trpc —— 覆盖率与 E2E 矩阵最完整的全栈范本

- 仓库：<https://github.com/trpc/trpc>
- **运行器**：根 `vitest ^4.0.18` + `@vitest/coverage-istanbul` + `@vitest/ui` + Testing Library（react/dom/user-event）；examples 内用 Playwright 跑浏览器 E2E。
- **测试位置**：每包 `packages/*/test/`；根 `vitest.config.ts` 用 `projects: ['./packages/*']` 分发，别名从各包 `package.json` exports 自动生成；`globals: true`、`restoreMocks: true`、CI 重试 2 次。
- **CI 结构**（[main.yml](https://github.com/trpc/trpc/blob/main/.github/workflows/main.yml)）：
  - job 族：`build` / `typecheck` / `typecheck-www`（依赖 build）/ `test`（单测+集成，跑 coverage）/ `e2e`（约 20 个 example 的矩阵 + **Postgres service 容器**）/ `e2e-deno` / `e2e-bun` / `e2e-legacy-node`（Node 18/20 矩阵）/ `release-tmp`（pkg.pr.new 预发布）/ `monotest-build`。
  - **没有独立 lint job**（lint 在别处/不做）。
  - 细节：concurrency 按 ref 取消；job 级 timeout（10/20 分钟）；`.github/setup` 本地 composite action 统一安装步骤；Turborepo 远程缓存；`fetch-depth: 0`。
  - `test` job 里还有"校验 openapi 测试夹具已提交"的防漂移步骤——**把 codegen 产物一致性做成 CI 步骤**，对 Colosseum 的 drizzle 迁移文件同样适用。
- **覆盖率**：istanbul provider，`include: **/src/**`，排除 examples/www/vendor；上传 Codecov 且 `fail_ci_if_error: true`（token 仅非 fork PR 注入）——7 仓中唯一"覆盖率进必检"的仓库。

### 3.6 drizzle-team/drizzle-orm —— 真实数据库的集成测试分片

- 仓库：<https://github.com/drizzle-team/drizzle-orm>
- **运行器**：Vitest（根 package.json 无 runner，由 `turbo run test` 下发到各 workspace 包执行）。
- **测试位置**：每包 `tests/` + 顶层 `integration-tests/` 独立包。
- **CI 结构**：[router.yaml](https://github.com/drizzle-team/drizzle-orm/blob/main/.github/workflows/router.yaml) 是路由层（fork PR / push → `release-feature-branch.yaml`，main 手动 dispatch → `release-latest.yaml`，同仓 PR 直接 skip 防重复）。[release-feature-branch.yaml](https://github.com/drizzle-team/drizzle-orm/blob/main/.github/workflows/release-feature-branch.yaml)：
  - `test` job：ubuntu-22.04 + **17 个分片矩阵**，**service 容器**起 3 种 Postgres（postgis/pgvector/14）+ MySQL 8 + SingleStore；各数据库凭据经 secrets 注入；fork PR 导出 `SKIP_EXTERNAL_DB_TESTS=1` 跳过外部 DB 分片——**外部依赖"有则跑、无则跳"的降级策略**直接可抄（对应 Colosseum 的 Redis/LLM 可选依赖）。
  - `attw` job：用 bun 跑 `attw` 验证包类型解析；`release` job：Node 24 + OIDC trusted publishing。
  - pnpm store 用 `actions/cache`（lockfile 哈希 key）。
- **覆盖率**：无。**未做**：无 lint job、无 concurrency、无路径过滤、无 timeout。

### 3.7 vercel/ai —— 路径过滤 + 矩阵 + 门禁聚合 job 的教科书

- 仓库：<https://github.com/vercel/ai>（AI SDK 5 即 Colosseum 的 `ai` 依赖）
- **运行器**：Vitest 4.1.6（`test:node` / `test:edge` 双环境任务 + turbo 分发）+ Playwright ^1.61.1（`packages/rsc` 的 E2E）。
- **测试位置**：**共置**——`packages/ai/src/generate-text/generate-text.test.ts` 与源码同目录，另有 `.test-d.ts` 类型测试与 `__snapshots__`；`src/test/` 存放测试工具（fixture/假 provider）。
- **CI 结构**（[ci.yml](https://github.com/vercel/ai/blob/main/.github/workflows/ci.yml)，12 个 workflow）：
  - `check`（biome/ultracite + 文档校验）、`konsistent`、`types`、`build-packages`（产物打成 tar artifact 供下游 job 下载复用，**避免每个 job 重复构建**）、`bundle-size`（下载产物跑包体积预算）、`build-examples`（4 分片矩阵）。
  - `test_node_versions` job 先决策矩阵：非 PR 或源码/测试变更 → `[22, 24, 26]`，否则 `[22]`——**矩阵按变更范围动态收缩**。
  - `test_matrix`：跑 `pnpm test:ci`（`SKIP_RSC_E2E=1`）；`test_ai_matrix`：Node 22/24/26 × 1/4~4/4 分片，node/edge 双任务；`test_mcp_windows`：Windows + Node 24；`test_rsc_e2e`：**路径过滤**（仅 `packages/rsc/**` 等变更才跑），装 Playwright Chromium。
  - `test` / `load-time` 是**门禁聚合 job**（`if: ${{ !cancelled() }}`，仅当所有依赖未失败/未跳过才绿）——给分支保护提供**稳定不变的必检 check 名字**，矩阵标签怎么变都不影响。
  - 缓存：pnpm + turbo 远程缓存 + Playwright 浏览器缓存（按解析版本 key）；全部 action 按 SHA 固定。
- **覆盖率**：无阈值；用 bundle-size 预算（ai: 105ms 级 load-time 与包体积阈值）替代。

---

## 4. 2026 生态关键事实核查（时间点：2026-09-07）

- **Vitest 版本线**：4.0（2025-10-22，Browser Mode 转稳定、`browser.instances` 取代 `browser.name`、内置视觉回归）→ 4.1（2026-03-12，Playwright Trace Viewer 集成、tags、`around` hooks）→ **5.0（2026-09-03，刚发布 4 天）**，4.1 线继续收安全补丁。npm registry 核实：`vitest@5.0.0` 为 latest。被调研仓库全部在 4.0.18~4.1.10。
- **Jest 与 React 19/Next 15**：社区普遍反映 Jest 在 React 19 + ESM 场景配置痛苦；Next.js 官方文档已提供 [Vitest 指南](https://nextjs.org/docs/app/guides/testing/vitest)（Jest 指南仍在但不再是首选叙事）。唯一还押 Jest 的 next.js 本仓是存量基建原因。
- **Playwright**：npm registry 核实 latest = 1.63.0（next.js 与 vercel/ai 均在 1.61.x，版本节奏吻合）。
- **Vitest Browser Mode vs Playwright**：官方文档定位 Browser Mode 为"组件级浏览器测试"（真浏览器跑组件，配套 `vitest-browser-react`、locator API、ARIA 快照、视觉回归），CI 需以 Playwright 或 WebdriverIO 作为驱动 provider（默认 preview provider 不能 headless）；**应用级 E2E（多页面流程、真实后端）仍是 Playwright Test 的领地**。vercel/ai、shadcn-ui 的实践一致：单测 Vitest + E2E Playwright，两者并存。
- **node:test**：7 仓无一以其为主运行器；它适合零依赖小工具，但断言/ mocking / UI 生态与报告体系均不及 Vitest，不推荐作为主栈。

---

## 5. 模式综合：2026 年的主流约定

### 5.1 运行器

Vitest 是事实标准（6/7）。选它的理由在被调研仓库中反复出现：原生 ESM/TS、Vite 管道启动快、workspace `projects` 原生支持多环境（node/edge/jsdom/browser）、与 `@vitest/coverage-v8`、`@vitest/eslint-plugin`、`.test-d.ts` 类型测试形成闭环。

### 5.2 测试位置：分离 vs 共置

| 模式 | 采用者 | 适合 |
|---|---|---|
| 顶层 `tests/` / `test/` | zustand、next.js（rootDir='test'） | **单包仓库**；想保持 src 纯净 |
| 包内 `tests/` / `test/` | drizzle、trpc、zod、shadcn | monorepo，测试随包走 |
| 源码共置 `*.test.ts` | vercel/ai、next.js（部分） | 迭代频繁的库源码，改哪测哪 |

对 Colosseum："工程和测试独立"是硬诉求，且是单包 npm 仓库 → **顶层 `tests/`**（zustand 同构先例）。代价是移动/重命名源文件时测试路径要同步，用目录镜像约定（`tests/unit/` 镜像 `src/` 结构）+ ESLint 边界规则缓解。

### 5.3 CI 结构的规模分层

- **小（≈Colosseum 现在）**：单 `ci.yml`，lint/typecheck/test/build 平行 job（zustand 把它们串进一个 job 也行，但平行 job 的失败定位与必检配置更清晰）。
- **中**：加路径过滤的 E2E workflow、Node 矩阵、覆盖率上传（trpc 形态）。
- **大**：可复用 workflow、变更检测 job、分片、门禁聚合 job、远程缓存（next.js / vercel/ai 形态）。
- **跨规模通用标配**（2026 年卫生线）：`permissions: contents: read`；PR 上 `concurrency` + `cancel-in-progress`；每 job `timeout-minutes`；`setup-node` 的 `cache: npm/pnpm`；action 尽量 SHA 固定；E2E 缓存 Playwright 浏览器；外部依赖（DB/LLM）不在单测 job 出现，真需要时用 service 容器或 secrets 降级跳过。

### 5.4 覆盖率

没有一家设全局阈值。务实做法分三档：只出报告（zustand/多数）→ 第三方平台 + 失败即红（trpc/Codecov）→ 用别的预算替代（vercel/ai bundle-size）。结论：**覆盖率是观测工具，不是门禁**；要上门禁就窄域（核心引擎目录）起步。

---

## 6. Colosseum 落地建议

### 6.1 测试运行器选型

- **主运行器：Vitest `^4.1`**（devDependencies：`vitest`、`@vitest/coverage-v8`；后续按需 `jsdom` + `@testing-library/react`）。理由：6/7 被调研仓库同选；zustand（直接依赖）就在 4.1.10；Next.js 官方有 [Vitest 指南](https://nextjs.org/docs/app/guides/testing/vitest)；React 19 无 Jest 式兼容坑。
- **版本策略**：5.0 刚发 4 天（2026-09-03），生态插件（如 vitest-browser-react）兼容性尚在收敛，**不抢跑**；季度复盘时再升。锁 `^4.1` 保证补丁线仍有安全回移。
- **E2E：Playwright `^1.63`** 独立于 Vitest（vercel/ai、shadcn-ui 同款分工）。观赛 UI 的多页面流程（创建比赛 → 观战 → 赛后查看）属于应用级 E2E，用 Playwright Test；**不建议**用 Vitest Browser Mode 承担——它是组件测试工具。若未来 poker/werewolf 的 UI 组件需要真浏览器组件测试，再评估 browser mode（`browser.instances` + playwright provider）。
- **环境分配**：默认 `environment: 'node'`（引擎/解析器/store 纯逻辑）；需要 DOM 的少量测试用 `projects` 拆 jsdom 项目；edge 场景（A2A 端点适配层）可仿 vercel/ai 拆 edge 项目——按需增加，起步只留 node。

### 6.2 目录布局（工程与测试独立）

```
.
├── src/                      # 工程代码：零 *.test.ts，零测试配置
├── tests/
│   ├── unit/                 # Vitest 单测，镜像 src 结构
│   │   ├── games/werewolf/engine/*.test.ts
│   │   ├── games/poker/engine/*.test.ts
│   │   ├── backend/a2a-core/*.test.ts
│   │   ├── backend/match/*.test.ts
│   │   ├── platform/core/*.test.ts
│   │   └── frontend/utils/*.test.ts
│   ├── e2e/                  # Phase C：Playwright 用例
│   ├── fixtures/             # 测试数据（牌谱、A2A 消息样本、思考链样本）
│   └── setup.ts
├── vitest.config.ts
└── playwright.config.ts      # Phase C 再加
```

`vitest.config.ts` 草案（别名对齐 tsconfig 的 `@/*` → `src/*`）：

```ts
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['tests/setup.ts'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
```

配套约定：

- 根 `tsconfig.json` 的 include 覆盖 `tests/`，让 `npm run typecheck` 连测试一起查（zustand/vercel/ai 同款：测试代码也要过 tsc）；测试内显式 `import { describe, it, expect } from 'vitest'`，不开 `globals`，省去类型配置纠缠。
- ESLint flat config 天然全仓扫描，`eslint .` 自动覆盖 `tests/`，无需额外配置。
- `package.json` 脚本：`"test": "vitest run"`、`"test:watch": "vitest"`、`"test:unit": "vitest run"`（Phase B 起生效；Phase A 期间维持占位亦可，CI 的 test job 对占位脚本天然绿）。Phase B 后追加 `"test:coverage": "vitest run --coverage"`。
- 旧的 `check:werewolf*` 闭环属于"带真实 LLM 的验收测试"，2026-09-07 已随测试清空删除；后续可从 git 历史复活并归入验收测试层（见 6.4 Phase C 与 §7 nightly 建议）。

### 6.3 CI 草案（`.github/workflows/ci.yml`，仅本报告内，不落盘）

设计要点：push/PR to main；Node 22（与 `.nvmrc` 生产钉死一致，亦是 next.js 仓的 LTS 锚点与 vercel/ai 的默认档）；`npm ci`；`setup-node` 自带 npm 缓存；`permissions` 最小化；PR concurrency 取消旧运行；lint / typecheck / test / build 四个平行 job；**单测阶段不需要 DB/Redis/LLM**（引擎纯逻辑 + fixture 驱动），`next build` 亦不触库。

```yaml
# .github/workflows/ci.yml —— 草案（Phase A 起可用，Phase B 只需改 test job 的命令）
name: CI

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  lint:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run lint

  typecheck:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run typecheck

  test:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      # Phase A：npm test 仍是占位脚本，天然通过
      # Phase B 起：npm run test:unit -- --coverage
      # 并追加（覆盖率 HTML 报告产物）：
      # - uses: actions/upload-artifact@v6
      #   if: always()
      #   with:
      #     name: coverage-report
      #     path: coverage/
      #     retention-days: 7
      - run: npm test

  build:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run build
```

补充说明：

- action 用 `@v6` major tag 便于阅读；真要供应链加固时按 zustand/vercel/ai 的做法改 SHA 固定（可后补，不阻塞上线）。
- `check:werewolf`（LLM 闭环）与 `check:werewolf-ui` **不进本 workflow**：需要真实 API key，且耗时长、结果非确定。建议后续加独立 `werewolf-nightly.yml`（`schedule` + `workflow_dispatch`，secrets 注入，`continue-on-error` 起步，趋势观察）。
- `check:surfaces` 是纯校验脚本（`node scripts/a2ui/validate-surfaces.mjs`），不需要外部依赖，可在 Phase A 就并进 CI（加一个 job 或并进 lint job）。
- 分支保护：以 `lint / typecheck / test / build` 四个 job 名为必检；将来矩阵化时仿 vercel/ai 加固定名的门禁聚合 job。

### 6.4 分阶段落地

**Phase A —— 先有 CI（无测试，1 个 PR）**

1. 落 `.github/workflows/ci.yml`（上面的草案，test job 跑占位脚本）。
2. 开分支保护：PR 必检 lint/typecheck/build（+test）。
3. 可选：把 `check:surfaces` 纳入 CI；验证 better-sqlite3 在 ubuntu + Node 22 的预编译安装无障碍。
4. 验收：红/绿可控（故意改坏一处 lint 与一处类型，确认分别红对应 job）。

**Phase B —— 恢复单测（工程价值最高，2~4 个 PR）**

1. 安装 `vitest@^4.1` + `@vitest/coverage-v8`（+ `@vitest/eslint-plugin`）；落 `vitest.config.ts`、`tests/` 骨架、`setup.ts`；改 `package.json` 脚本；tsconfig include `tests/`。
2. 按价值顺序补测试（旧套件 98 文件的可回收逻辑优先）：
   - `src/games/*/engine`：发牌/轮次/胜负判定/状态机（纯函数，fixture 驱动）；
   - `src/backend/a2a-core`：消息解析、schema（zod）校验、协议边界；
   - `src/backend/match`：编排器状态流转（mock agent）；
   - `src/platform/core` 与前端 utils/store（zustand store 用 jsdom 项目）。
3. CI test job 切到 `vitest run --coverage`，上传覆盖率 artifact。
4. 验收：`npm test` 本地与 CI 一致；`src/` 内 grep 不到 `*.test.ts`。

**Phase C —— E2E 与进阶（观赛 UI 上保险）**

1. 安装 `@playwright/test`，`playwright.config.ts`（webServer 用 `next build && next start` 或仿 shadcn 用 `start-server-and-test`；基础 URL 指向本地端口）。
2. 首批用例：首页/创建比赛页渲染、A2UI surfaces 冒烟、赛后排名/筹码图页面（recharts 断言用 `getByRole` 级别，不抠像素）。
3. 独立 `e2e.yml` + **路径过滤**（仅 `src/frontend/**`、`src/app/**`、playwright 配置变更才跑，仿 vercel/ai/shadcn）+ Playwright 浏览器缓存；trace/screenshot 失败上传 artifact。
4. 视需要起 `docker compose`（Redis）作为 service；LLM 依赖一律 mock 或用录制 fixture——E2E 不打真实模型。
5. 独立 `werewolf-nightly.yml` 承接 `check:werewolf` 闭环（secrets + 手动触发 + 趋势记录）。

### 6.5 覆盖率工具与阈值策略

- 工具：`@vitest/coverage-v8`（zustand 同款；istanbul 留给需要更精细插桩时再换，trpc 先例证明两者都可行）。
- Reporter：本地 `text` + `text-summary`；CI 追加 `github-actions`（zustand 做法直接抄）+ `html`（artifact 留档）+ 可选 `junit`。
- 阈值策略（三步走，避免一上来就红）：
  1. **Phase B 前 4 周：零阈值**，只出报告，建立基线；
  2. 稳定后对 `src/games/**` 设 `lines/branches ≥ 70%` 起步（引擎是规则正确性所在，最值得门禁）；
  3. 采用"棘轮"（ratchet）：阈值只升不降；`src/app/**`（Next.js 胶水层）与 UI 组件**永不设全局阈值**（被调研仓库无一对全局设阈值）。
  4. 不引入 Codecov 等第三方平台，直到报告消费成为真实痛点（GitHub 内联 reporter + artifact 已够用）。

---

## 7. 参考链接

一手（2026-09-07 抓取）：

- vercel/next.js：<https://github.com/vercel/next.js> · [build_and_test.yml](https://github.com/vercel/next.js/blob/canary/.github/workflows/build_and_test.yml) · [jest.config.js](https://github.com/vercel/next.js/blob/canary/jest.config.js)
- pmndrs/zustand：<https://github.com/pmndrs/zustand> · [test.yml](https://github.com/pmndrs/zustand/blob/main/.github/workflows/test.yml) · [test-multiple-versions.yml](https://github.com/pmndrs/zustand/blob/main/.github/workflows/test-multiple-versions.yml)
- shadcn-ui/ui：<https://github.com/shadcn-ui/ui> · [test.yml](https://github.com/shadcn-ui/ui/blob/main/.github/workflows/test.yml) · [browser-tests.yml](https://github.com/shadcn-ui/ui/blob/main/.github/workflows/browser-tests.yml)
- colinhacks/zod：<https://github.com/colinhacks/zod> · [test.yml](https://github.com/colinhacks/zod/blob/main/.github/workflows/test.yml)
- trpc/trpc：<https://github.com/trpc/trpc> · [main.yml](https://github.com/trpc/trpc/blob/main/.github/workflows/main.yml) · [vitest.config.ts](https://github.com/trpc/trpc/blob/main/vitest.config.ts)
- drizzle-team/drizzle-orm：<https://github.com/drizzle-team/drizzle-orm> · [router.yaml](https://github.com/drizzle-team/drizzle-orm/blob/main/.github/workflows/router.yaml) · [release-feature-branch.yaml](https://github.com/drizzle-team/drizzle-orm/blob/main/.github/workflows/release-feature-branch.yaml)
- vercel/ai：<https://github.com/vercel/ai> · [ci.yml](https://github.com/vercel/ai/blob/main/.github/workflows/ci.yml)

二手（版本与兼容性核查）：

- Vitest 博客/时间线：<https://vitest.dev/blog> · [Vitest 5.0](https://vitest.dev/blog/vitest-5.html) · [Vitest 4.0](https://vitest.dev/blog/vitest-4) · [Vitest 4.1](https://vitest.dev/blog/vitest-4-1.html) · [Browser Mode 指南](https://vitest.dev/guide/browser/)
- Next.js 官方 Vitest 指南：<https://nextjs.org/docs/app/guides/testing/vitest>
- npm registry：`vitest@5.0.0`、`playwright@1.63.0`（2026-09-07 查询 registry.npmjs.org）
