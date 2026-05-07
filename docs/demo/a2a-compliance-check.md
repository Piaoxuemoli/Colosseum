# A2A v0.3 合规 · 手动验证

本项目的 Agent endpoint 符合 [A2A v0.3](https://github.com/a2aproject/a2a-js) 协议。
检查清单：

## 协议路径约定

A2A 规范的方法名是 `message:stream`（带冒号）。Next.js App Router 文件路径不能包含冒号，
所以物理路径使用 `/api/agents/[agentId]/message/stream`，但 JSON-RPC `method` 字符串仍然是
`"message/stream"`。同时 endpoint 向后兼容直接 `{ message: {...} }` 的旧 body。

## AgentCard

```bash
curl http://localhost:3000/api/agents/toy-poker/.well-known/agent-card.json | jq
```

验证：
- [ ] 返回 200 + JSON
- [ ] `protocolVersion` 以 `0.3` 开头
- [ ] 字段齐全：`name` / `description` / `version` / `url` / `capabilities`
      / `skills[]` / `defaultInputModes` / `defaultOutputModes`
- [ ] 对于 `agt_*` 的真实 agent，`securitySchemes.apiKey` 含 `{ location: 'header', name: 'X-Match-Token' }`
- [ ] 对于 `gameType = 'poker'` 的 agent，`skills[0].id === 'poker-decision'`
- [ ] 对于 `gameType = 'werewolf'` + `kind = 'player'` 的 agent，`skills[0].id === 'werewolf-decision'`
- [ ] 对于 `gameType = 'werewolf'` + `kind = 'moderator'` 的 agent，`skills[0].id === 'werewolf-moderator'`

## JSON-RPC `message/stream`

```bash
# 正常请求 (toy-poker 始终 fold)
curl -N -X POST http://localhost:3000/api/agents/toy-poker/message/stream \
  -H 'content-type: application/json' \
  -H 'X-Match-Token: toy-token' \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "message/stream",
    "params": {
      "message": {
        "messageId": "m1",
        "taskId": "t-compliance-1",
        "role": "user",
        "parts": [{ "kind": "data", "data": {} }]
      }
    }
  }'
```

验证：
- [ ] 响应 200，`Content-Type: text/event-stream`
- [ ] 帧里包含 `status-update` × 多条（至少 `submitted` → `working` → `completed`）
- [ ] 帧里至少 1 条 `artifact-update` 的 `parts: [{ kind: 'data', data: { action: 'fold' } }]`

## 错误路径

```bash
# 错误 method → -32601
curl -s -X POST http://localhost:3000/api/agents/toy-poker/message/stream \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"wrong/method","params":{"message":{"messageId":"m","taskId":"t","role":"user","parts":[]}}}' \
  | jq
```

- [ ] 返回 404 + JSON `{ jsonrpc:"2.0", id:2, error:{ code:-32601, ... } }`

```bash
# 真实 agent 缺 X-Match-Token → -32001
curl -s -X POST http://localhost:3000/api/agents/agt_xxx/message/stream \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":3,"method":"message/stream","params":{"matchId":"m1","message":{"messageId":"m","taskId":"t","role":"user","parts":[]}}}' \
  | jq
```

- [ ] 返回 401 + JSON `{ jsonrpc:"2.0", id:3, error:{ code:-32001, message:"invalid match token" } }`

## SSE 帧顺序

在完整一次 LLM 请求里，帧顺序应该是：

```
status-update: submitted
status-update: working
artifact-update: text (delta=true) × N   # thinking delta，可能为 0
artifact-update: data (delta=false)      # 最终 action
status-update: completed | failed
```

- [ ] 观察 devtools / curl 的 SSE 输出符合上述顺序

## 第三方客户端（可选）

使用 `@a2a-js/sdk` 的内置 `A2AClient` 直连 endpoint 应该能正确读到 action。
本项目封装了 `requestAgentDecisionRpc` 在 `lib/a2a-core/client.ts`：

```ts
import { requestAgentDecisionRpc } from '@/lib/a2a-core/client'
const r = await requestAgentDecisionRpc({
  baseUrl: 'http://localhost:3000',
  agentId: 'toy-poker',
  taskId: 't',
  message: { role: 'user', parts: [{ kind: 'data', data: {} }] },
  matchToken: 'toy-token',
})
// r.action === 'fold'
```

- [ ] `r.action` 非空；`r.thinkingText` 可能为空字符串；`r.fallback` 为 false
