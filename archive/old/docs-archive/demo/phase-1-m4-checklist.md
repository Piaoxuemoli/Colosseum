# Phase 1 M4 · 6 LLM End-to-End Checklist

**Goal:** 6 个真实 LLM agents 打完一整场 6-max 德扑，UI / SSE / 记忆 / 错误兜底全链路可用。

## 准备

- [ ] 本地 `.env` 配置完成，`BASE_URL` 指向当前 Next.js 服务。
- [ ] Redis 可用，match token / match-scoped keyring 能正常读写。
- [ ] 在 UI 创建 2+ 个 provider profile，例如 DeepSeek / OpenAI / Anthropic。
- [ ] 在 UI 创建 6 个 poker agents，分散到 2-3 个 provider profile 上。
- [ ] 每个 agent 的 system prompt 有区分，例如 tight / loose / aggressive / balanced。
- [ ] 客户端 keyring 已为每个 profile 填入 API key，UI 显示 key 检查通过。

## 创建 Match

- [ ] 访问 `/matches/new`，选择 6 个 poker agents。
- [ ] 配置 blinds、initial chips、agent timeout、min action interval。
- [ ] 点击开始对局。
- [ ] 浏览器网络面板可见 POST `/api/matches` 成功返回 `matchId`。
- [ ] 浏览器网络面板可见 POST `/api/matches/:id/keys` 返回 204。
- [ ] 页面跳转到 `/matches/:id`。

## 观战进行时

- [ ] 牌桌展示 6 个座位、名字、头像、筹码。
- [ ] agent 思考时，座位上方 ThinkingBubble 流式追加文字。
- [ ] agent 行动完成后，当前行动者状态清理，牌桌筹码 / pot / phase 更新。
- [ ] 右侧 ActionLog 滚动追加行动。
- [ ] 右侧 Thinking tab 能看到当前思考流。
- [ ] 每手结束后 ChipChart 增加数据点，LiveScoreboard 排名变化。
- [ ] 至少制造一次 LLM 异常，确认 ErrorBadge 增加且对局继续使用 bot fallback。

## 结束

- [ ] 对局结束后 UI 自动弹出 RankingPanel。
- [ ] 排名、盈亏、奖牌显示正确。
- [ ] 返回大厅按钮跳回 `/`。

## 健壮性

- [ ] 刷新浏览器后，观战页能从 match detail + public events 重建状态。
- [ ] SSE 短暂断开后重连不会导致页面崩溃。
- [ ] 单个 agent endpoint 失败不会中断整场 match。

## 验收记录

- [ ] 所有 checkbox 勾选完成。
- [ ] 记录 match id、最终排名、关键截图路径。
- [ ] 问题和修复记录写入 `docs/demo/m4-run-notes.md`。
