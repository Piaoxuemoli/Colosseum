# AI 基建说明

这套基建的目标是轻量化：让 AI 能稳定读懂仓库、按 plan 执行、记录进度，并把高频流程封装成一个命令。

## 文件说明

| 文件 | 作用 |
|---|---|
| `AGENTS.md` | 所有 AI 助手的项目入口，说明项目定位、红线、执行方式 |
| `docs/ai/rules/` | 详细规则正文：项目、lint、UI、前后端、spec/plan 工作流 |
| `.cursor/rules/` | Cursor 轻量路由规则，只指向 `docs/ai/rules/` |
| `.claude/rules/` | Claude 轻量路由规则，与 `.cursor/rules/` 对齐 |
| `.cursor/commands/execute-plan.md` | 高频执行流命令：读 spec + plan → 执行下一个 checkbox → 验证 → 更新状态 |
| `.claude/commands/execute-plan.md` | Claude 侧同名命令说明，与 Cursor 命令对齐 |
| `docs/ai/session-state.md` | 长任务状态，给上下文压缩、换 Agent、暂停恢复使用 |

规则正文索引见 `docs/ai/rules/README.md`。Git 分支、提交、合入规范见 `docs/ai/rules/git-workflow.md`。

## 推荐工作流

### 写新 plan

1. 在 `docs/superpowers/plans/` 新建 markdown。
2. 每个任务使用 checkbox：`- [ ] Step ...`。
3. 写清楚文件列表、验证命令、Done 定义和 SDK 漂移风险。
4. 如果新 plan 依赖某个 spec 决策，在 plan 顶部引用具体 spec 文件。

### 执行 plan

在 Cursor 里使用：

```text
/execute-plan
```

如果有多个 plan，直接补充说明：

```text
/execute-plan docs/superpowers/plans/2026-05-06-phase-0-skeleton.md
```

执行完成后，AI 应该更新：

1. 当前 plan 的 checkbox
2. `docs/ai/session-state.md`
3. 必要时更新 spec/notes 中的已知偏差

## 维护原则

- `.cursor/rules` 和 `.claude/rules` 保持短，只做路由。
- 详细规范写在 `docs/ai/rules/`，避免每次都加载全部上下文。
- 命令封装流程，不封装业务判断。
- session state 只记录继续工作必需的信息，不写流水账。
- `old/` 只作为参考，不把旧项目规则原样搬进新仓库。
