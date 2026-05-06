# AI 规则路由

本目录存放详细 AI 协作规则。`.cursor/rules` 和 `.claude/rules` 只保留路由说明，避免每次会话都加载完整规范。

## 规则索引

| 场景 | 读取文档 |
|---|---|
| 项目整体上下文、架构红线 | `docs/ai/rules/project-context.md` |
| 新设备初始化、环境检测、开发前同步 | `docs/ai/rules/development-environment.md` |
| lint、格式化、类型检查、测试与质量门禁 | `docs/ai/rules/linting-and-quality.md` |
| UI 视觉风格、交互、组件约定 | `docs/ai/rules/ui-style.md` |
| 前后端边界、API、数据、安全注意事项 | `docs/ai/rules/frontend-backend.md` |
| spec/plan 写作、执行、状态更新 | `docs/ai/rules/spec-plan-workflow.md` |
| Git 分支、提交、合入、AI git 安全边界 | `docs/ai/rules/git-workflow.md` |

## 使用原则

- AI 不需要默认读取所有规则。
- 先读 `AGENTS.md`，再按任务类型读取本目录中相关文档。
- 修改规则时优先改 `docs/ai/rules/*.md`，只在路由变化时改 `.cursor/` 或 `.claude/`。
