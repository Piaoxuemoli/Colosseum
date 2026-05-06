# 前后端注意事项

Colosseum 是 Next.js App Router 项目。前端负责配置、观战和展示；后端 Route Handler 负责 A2A 端点、LLM 调用边界、持久化和实时事件。

## 前端边界

- 前端可以保存用户 API Profile 配置，但 API key 只存在浏览器本地，不同步到 DB。
- 创建比赛时，前端把本局需要的 key 传给服务端内存 keyring；服务端不持久化。
- 前端不要直接调用外部 LLM API，统一通过服务端 Route Handler / Agent endpoint。
- UI 状态和服务端对局状态分清：权威 match state 来自 GM，不从 UI 乐观推导。
- SSE 消费端要处理断线、重复事件、结束事件和错误事件。

## 后端边界

- Route Handler 是 HTTP 边界，负责鉴权、schema 校验、错误响应和调用业务层。
- 业务协调放在 `lib/orchestrator/` 或相近层，不把复杂流程塞进 route 文件。
- DB 访问集中在 `lib/db/` 或 repository/service 层，不在 UI 组件中 import。
- Redis 只放活动对局状态、锁、pub/sub 和短期 keyring；长期事实落 DB。
- LLM 调用统一走 provider factory / gateway，不能在各处散落 SDK 初始化。

## API 设计

- 请求体和响应体都用 Zod 或显式类型描述。
- Route Handler 默认 `runtime = 'nodejs'`，因为 A2A、DB、Redis、LLM SDK 依赖 Node 能力。
- 错误响应保持结构化：`{ error, code?, details? }`。
- 外部可观察事件使用稳定字段名，避免 UI 根据自然语言解析。

## 数据与安全

- 持久化事实：matches、agents、game_events、memory、profiles 元数据。
- 不持久化秘密：LLM API key、临时 match token、cookie、私钥。
- 日志不要打印 API key、完整请求头、用户输入的密钥字段。
- DB migration 应可重复执行并进入版本控制；本地临时 DB 文件不入库。

## 实时与并发

- 每个 match 需要并发锁，避免多个 tick 同时推进。
- SSE 只负责广播事件，不作为唯一事实来源；可从 DB events 恢复。
- Agent timeout、最小动作间隔、失败重试要在 GM/orchestrator 层统一处理。
- 多对局并发时，Redis key 必须带 matchId 和 agentId，避免串扰。

## 游戏自治

- 新增游戏时，优先创建 `games/<game>/` 下完整模块。
- 平台层提供接口和基础设施，游戏层提供规则、prompt、parser、bot、UI。
- 如果发现共享层需要认识具体游戏名，先重新检查抽象边界。
