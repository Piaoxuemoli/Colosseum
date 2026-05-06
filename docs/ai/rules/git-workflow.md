# Git 工作流规范

这份规则用于规范分支、提交和合入流程。目标是让人和 AI 都能按同一套节奏协作，避免混乱历史、误提交密钥和大范围无关改动。

## 分支类别

| 类别 | 用途 | 命名格式 |
|---|---|---|
| `main` | 稳定主线，可演示、可继续开发 | 固定名称 |
| `feature` | 新功能、Phase 任务、可独立验收的能力 | `feature/<scope>-<short-desc>` |
| `fix` | 缺陷修复、回归修复 | `fix/<scope>-<short-desc>` |
| `chore` | 工程化、依赖、配置、脚本、AI 基建 | `chore/<scope>-<short-desc>` |
| `docs` | 文档、spec、plan、README、规则 | `docs/<scope>-<short-desc>` |
| `refactor` | 不改变行为的结构调整 | `refactor/<scope>-<short-desc>` |
| `test` | 测试补充或测试基础设施 | `test/<scope>-<short-desc>` |
| `hotfix` | 主线紧急修复 | `hotfix/<scope>-<short-desc>` |

## 分支命名

- 全部小写，单词用短横线连接。
- `scope` 使用模块或阶段名，如 `p0`、`p1a`、`poker`、`a2a`、`docs-ai`、`ui`。
- `short-desc` 控制在 3-6 个英文单词或拼音词内，表达结果而不是过程。
- 不在分支名中放姓名、日期、密钥、任务系统 URL。

示例：

```text
feature/p0-skeleton
feature/p1a-poker-engine
fix/a2a-stream-timeout
chore/docs-ai-rules
docs/rewrite-spec-diagrams
refactor/game-registry
test/poker-engine-cases
hotfix/prod-healthcheck
```

## 日常同步

开发前把拉取远端更新视为本能动作，但必须安全执行：

```bash
npm run sync
```

该命令封装了：

- 工作区干净才拉取
- 有 upstream 才拉取
- 先 `git fetch --all --prune`
- 再 `git pull --ff-only`
- 不修改 git remote / git config

如果 `npm run sync` 提示工作区不干净，先处理本地改动；不要强行 pull、reset 或覆盖用户文件。

## 本地分支拉取策略

本地开发默认流程：

1. 确认当前分支：`git status --short --branch`
2. 安全同步：`npm run sync`
3. 如果要开始新任务，从最新主线切任务分支：

```bash
git switch main
npm run sync
git switch -c feature/<scope>-<short-desc>
```

已有任务分支继续开发时：

```bash
npm run sync
```

如果任务分支没有 upstream，首次推送时由用户明确决定是否执行：

```bash
git push -u origin HEAD
```

不要在本地有未提交改动时强行 rebase、merge、pull 或切分支。

## 自动分步提交

执行 plan 时按 task 边界提交，避免把多个任务堆进一个大提交。推荐命令：

```bash
npm run commit:step -- "feat(p0): add env loader"
```

该命令会：

- 检查工作区是否有改动
- 阻止明显敏感文件提交
- 执行 `git add -A`
- 执行 `git diff --cached --check`
- 打印 staged 文件列表
- 创建一个 Conventional Commit

分步提交的默认粒度：

- 一个 plan task 一个提交
- 依赖安装单独提交
- 规则/文档变更单独提交
- 修复验证失败的补丁可以跟随同一 task 提交

AI 只有在用户明确进入“执行态并允许分步提交”或明确要求提交时，才执行 `npm run commit:step`。

## 提交规范

使用 Conventional Commits 的轻量版：

```text
<type>(<scope>): <summary>
```

常用 `type`：

- `feat`：新增用户可见能力或主要功能
- `fix`：修复 bug
- `docs`：文档、spec、plan、规则
- `test`：测试
- `refactor`：不改变行为的结构调整
- `chore`：配置、依赖、脚本、AI 基建、仓库维护
- `style`：格式、样式微调，不影响逻辑
- `perf`：性能优化
- `build`：构建系统、打包、CI

示例：

```text
feat(p0): add toy a2a stream endpoint
fix(poker): reject invalid raise amount
docs(ai): add git workflow rules
chore(lint): add project quality gate scripts
test(engine): cover showdown side pots
```

## 提交粒度

- 一个提交只表达一个完整意图。
- 不把格式化、重构、功能、文档混成一个大提交。
- 不提交无关文件、临时文件、生成缓存、调试输出。
- 不提交 `.env*`、API key、token、cookie、私钥、`old/ops/private/*`。
- AI 只有在用户明确要求，或当前会话已明确进入允许自动分步提交的执行态时才创建 commit；不要在普通问答中擅自 commit。

## 合入规范

合入主线前至少满足：

1. 分支基于当前 `main` 或已明确处理冲突。
2. PR / MR 描述清楚：目的、主要改动、验证方式、已知风险。
3. 相关验证通过；如果不能运行，说明原因。
4. 没有无关大改、无关格式化、无关旧项目改动。
5. 涉及 spec/plan/规则变更时，同步更新对应 docs 和 `docs/ai/session-state.md`。

推荐合入方式：

- 小型线性分支：Squash merge，保持主线清爽。
- 需要保留阶段过程的长分支：普通 merge，但提交历史必须可读。
- 禁止 force push 到 `main`。
- 禁止绕过 hooks 或验证，除非用户明确批准并记录原因。

## AI 执行 Git 的安全规则

- 执行 commit 前必须先看 `git status`、`git diff`、最近提交风格。
- 执行 plan 时优先用 `npm run commit:step -- "<message>"` 做 task 边界提交。
- 不 revert 用户已有改动，除非用户明确要求。
- 不运行破坏性命令，如 `git reset --hard`、`git checkout -- <file>`、`git clean -fd`。
- 不 push，除非用户明确要求。
- 如果发现密钥或敏感文件被要求提交，先提醒用户并拒绝直接提交。
- 合入、rebase、amend、force push 属于高风险操作，必须有明确用户指令。
