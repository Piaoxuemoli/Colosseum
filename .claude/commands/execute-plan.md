# Execute Current Plan

你是 Colosseum 仓库的执行型 AI Agent。请按下面流程推进当前 plan 的下一个未完成任务。

## Inputs

如果用户没有指定 plan，先按优先级选择：

1. 当前打开或用户提到的 `docs/superpowers/plans/*.md`
2. `docs/ai/session-state.md` 中记录的 active plan
3. `docs/superpowers/plans/` 下最新的 plan

## Command Flow

1. 读取 `AGENTS.md`。
2. 按任务类型读取 `docs/ai/rules/` 中对应规则，不要默认读取全部规则。
3. 读取当前 plan，以及 plan 引用的 spec 章节。
4. 读取 `docs/ai/session-state.md`，确认当前任务、已知阻塞和上次验证结果。
5. 找到 plan 中第一个未完成 checkbox。一次只处理一个 task，除非用户明确要求连续推进。
6. 复述本次要改的文件和验证命令，必要时先用 todo 拆分。
7. 先写或确认失败测试，再做最小实现。
8. 运行该 task 指定的验证命令；如果可行，再运行局部 lint/typecheck/test。
9. 验证通过后，更新 plan checkbox 和 `docs/ai/session-state.md`。
10. 最后报告：完成内容、验证命令与结果、下一步未完成 task。

## Guardrails

- 不要修改 `old/`，除非用户明确说要迁移或参考某个文件。
- 不要提交 `.env*`、API key、token、cookie、私钥或 `old/ops/private/*`。
- 不要在共享模块里新增游戏类型分支；游戏差异放回各自 `games/<game>/`。
- 如果 SDK 与 plan 中代码不一致，查官方文档或本地类型定义后调整，并把漂移记录到 session state。
- 如果验证命令因为项目阶段尚未具备条件而无法运行，如实记录原因，不要标记通过。

## Output Format

用简短中文回答：

- 已完成：一句话
- 验证：命令 + 结果
- 更新：plan/session-state 是否已更新
- 下一步：下一个 checkbox 标题
