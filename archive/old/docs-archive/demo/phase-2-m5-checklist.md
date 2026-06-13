# Phase 2 M5 · 合规 + 多对局 + 观测

## 合规（已在 P2-1 验）
- [ ] AgentCard 可 curl（见 `docs/demo/a2a-compliance-check.md`）
- [ ] JSON-RPC `message/stream` 工作正常

## 多对局
- [ ] UI 开两个 tab 分别创建 6-bot match，同时进行互不串扰
- [ ] 任一 match 的 ErrorBadge 只反映自己 match 的错误
- [ ] 任一 match 结束后另一 match 不受影响
- [ ] 自动化 e2e：`tests/integration/concurrent-matches.test.ts` 绿

## 观测
- [ ] `GET /api/health` 200 + JSON `{ ok, db, redis }`
- [ ] `GET /api/metrics` 200 + JSON 包含 `counters` / `histograms`
  - 跑一次 6-bot match 后应能看到 `tick.count{gameType=poker,...}` / `tick.duration_ms{gameType=poker}` / `agent.request_ms{gameType=poker}` / `agent.fallback{...}`
- [ ] 日志是单行 JSON（grep `"msg":"tick skipped: locked"` 能找到）

## 安全 / 会话
- [ ] 设 `MATCH_TOKEN_SECRET` 后，HMAC 签名器 (`lib/auth/match-token.ts`) 对 matchId + exp 正确签名
- [ ] 过期 / 篡改 token 验签失败
- [ ] `MATCH_TOKEN_SECRET` 未设置时，`signMatchTokenHmac` 抛错

## ErrorBadge
- [ ] 故意让一个 agent endpoint 返回 500，ErrorBadge 弹出
- [ ] popover 按 errorCode 分组；点开 details 显示前 5 条原始响应
