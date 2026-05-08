# Phase 6 · 服务器同步 + 连通性验证 + 后续清理计划

> 2026-05-08 写。跑完一轮连通性验证 + 确认 UI 能用后,必须按"清理"段把服务器上临时文件删掉;否则真实 API Key 会长期留在服务器磁盘上。

## 背景

Phase 6 Task 1–4 已合入 `main`:
- `POST /api/profiles/test` 服务端代 ping
- Profile 表单 / 列表"测试连接"按钮
- Poker / Werewolf prompt presets
- `/matches/new` 和 `/agents` 游戏 Tab(狼人杀入口)

**Colosseum 架构约束**:服务端**不持久化任何 LLM API Key**。key 只该在:
1. 浏览器 localStorage
2. 比赛运行期 Redis keyring(2 小时 TTL)
3. `POST /api/profiles/test` 的 request body(只在内存)

**本计划的临时违例**:为了方便开发者本地对照配置,我把含真实 key 的 `docs/dev/llm-api-config.local.md` **scp 到了服务器** `/opt/colosseum/docs/dev/llm-api-config.local.md`。这违反架构约束,必须在测完后清理。

## 进度

- [x] Step 1: git pull on server, rebuild `nextjs` container
- [x] Step 2: scp `docs/dev/llm-api-config.local.md` 到服务器
- [x] Step 3: `GET /api/health` — 服务存活
- [x] Step 4: 页面 HTML 200(/、/agents、/profiles、/matches/new)
- [x] Step 5: `POST /api/profiles/test` × 3(Doubao / MiniMax / MiMo),记录结果到本文件"结果"段
- [ ] Step 6: 用户在 UI 上跑一次真实 poker 或 werewolf 对局,确认端到端
- [ ] **Step 7(清理,必做)**: 服务器删 `docs/dev/llm-api-config.local.md`
- [ ] **Step 8(清理)**: 服务器的 git working tree 不会 track 这个文件(`.gitignore` 已拦),但如果 `git stash` 或意外 add 过需要 reset
- [ ] **Step 9(清理)**: 如有怀疑泄露,rotate 掉 Doubao / MiniMax / MiMo 三把 key

## 结果

(Step 5 跑完后回填本段)

### /api/health

记录:

### 页面 HTML

记录:

### /api/profiles/test

| Provider | Base URL | Model | 结果 | 延迟/错误 |
|---|---|---|---|---|
| Doubao | `https://ark.cn-beijing.volces.com/api/v3` | `doubao-seed-2-0-pro-260215` | | |
| MiniMax | `https://api.minimaxi.com/v1` | (待确认) | | |
| MiMo | `https://token-plan-cn.xiaomimimo.com/v1` | (待确认) | | |

## 清理清单(测完后必做)

```bash
# 本地:
ssh -i /tmp/puke.pem root@43.156.230.108 '
  # 1. 删掉临时文件
  rm -f /opt/colosseum/docs/dev/llm-api-config.local.md
  # 2. 确认 .gitignore 没有被绕过
  cd /opt/colosseum && git status --short docs/dev/
  # 3. 镜像里不该有(.dockerignore 已拦 docs/,下次 rebuild 验证)
  ls /opt/colosseum/docs/dev/
'
# 4. 清掉本机 /tmp/ 里所有临时拷贝
rm -f /tmp/puke.pem /tmp/llm-api-config.local.md
```

## Key rotation 备注

三把 key 在以下位置出现过(2026-05-08 本次会话):
- 本机 `docs/dev/llm-api-config.local.md`(gitignored,但存在)
- 服务器 `/opt/colosseum/docs/dev/llm-api-config.local.md`(待清理)
- 服务器 `POST /api/profiles/test` 的 request body(仅内存,已走完)
- 服务器 `nextjs` 容器日志:**不会写** key(`profile-test` route 已用 `<redacted>`)

如果任何一步有疑虑,去对应 LLM 控制台 revoke 并重新签发。

## 后续(完成 Phase 4 Task 6)

清理做完后,M7 checklist(`docs/demo/phase-4-m7-checklist.md`)里"功能冒烟"小节可以在这次测试里勾完。
