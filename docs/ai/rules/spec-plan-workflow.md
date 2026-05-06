# Spec 与 Plan 工作流

## 文档职责

- Spec 解释为什么：目标、约束、架构、锁定决策、风险。
- Plan 解释怎么做：文件、步骤、验证命令、完成定义。
- Session state 解释当前做到哪里：活动 plan、当前任务、阻塞、验证日志。

## 写 Spec

- 先给结论，再给理由。
- 锁定决策要可编号、可引用。
- Mermaid 图优先使用简单 ASCII 节点 ID 和带引号 label，避免复杂符号导致渲染失败。
- 当同一决策同时出现在 brief 和 design 中，修改时两边同步。

## 写 Plan

Plan 放在 `docs/superpowers/plans/`，使用 checkbox 作为执行状态：

```markdown
- [ ] Step 1: ...
- [ ] Step 2: ...
```

每个 plan 至少包含：

- Goal
- Architecture summary
- Tech stack / dependencies
- Files
- Task steps
- Validation commands
- Done definition
- SDK drift notes

## 执行 Plan

执行时使用 `/execute-plan`。AI 应：

1. 读取 `AGENTS.md` 和 `docs/ai/session-state.md`。
2. 读取当前 plan 和引用的 spec。
3. 找到第一个未完成 checkbox。
4. 一次只做一个任务，除非用户要求连续推进。
5. 先写或确认失败测试，再写实现。
6. 运行 task 指定验证命令。
7. 验证通过后更新 checkbox 和 session state。

## 状态记录

`docs/ai/session-state.md` 只记录恢复工作必需的信息：

- active spec / plan / phase / task
- last known status
- validation log
- blockers
- SDK drift notes

不要写流水账，不要记录密钥或私有信息。
