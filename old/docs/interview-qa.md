# 面试常见问题 — LLM Poker Arena

## Q1: 为什么选择纯前端架构？没有后端不会有安全问题吗？

**回答**: 这是一个 AI 对战观赏/训练工具，不涉及真钱或多人在线竞技，所以不需要服务端权威。纯前端的好处是：

1. **零部署成本** — `npm run build` 生成静态文件，任何静态托管即可运行
2. **隐私** — API Key 存在用户浏览器 IndexedDB 中，不经过任何中间服务器
3. **延迟** — 浏览器直连 LLM API，省去一跳中转

API Key 安全性方面：Key 只存在 IndexedDB，不会出现在 URL 或 localStorage 中。因为是单用户本地工具，风险可控。如果要多用户化，可以加一个 proxy 后端来托管 Key。

---

## Q2: 为什么用适配器模式处理三种玩家？直接 if-else 不行吗？

**回答**: 适配器模式的核心价值是**统一异步接口**。三种玩家的决策机制完全不同：

- Human: 等待 UI 按钮点击（不确定时长的 Promise）
- Bot: 同步计算（~10ms）
- LLM: 异步 API 调用（2-30s，含流式输出）

统一为 `async decide() → DecisionResult` 后，`processNextAction()` 不需要关心当前是谁在决策，代码从 3 条路径简化为 1 条。新增玩家类型（比如 MCTS Bot）只需实现接口，不改调用方。

---

## Q3: LLM 的 Context 怎么管理？不会越来越长吗？

**回答**: 这是本项目最核心的设计之一 — **印象蒸馏**。

**问题**: 如果每手都把完整行动记录放进 context，100 手后 context 会爆炸。

**解决方案**: 两级上下文策略：
1. **当手 context**: System（角色+规则+印象） + User（当手完整状态+行动+合法操作）— 只含当前手的详细信息
2. **跨手记忆**: 每手结束后，额外调用 LLM 生成 ≤20 字/人的对手印象 → 替换存储 → 下一手的 System Message 中作为"你对其他玩家的印象"出现

这样 context 长度恒定（约 1500-2500 tokens），不随手数增长，而 LLM 仍然"记得"之前的对手行为模式。

---

## Q4: 流式输出是怎么实现的？

**回答**: 用标准的 Server-Sent Events (SSE) 协议：

1. 请求时加 `stream: true`
2. 用 `response.body.getReader()` + `TextDecoder` 逐块读取
3. 每个 `data:` 行解析 JSON，提取 `choices[0].delta.content`
4. 拼接到 fullText，每次拼接后调用 `onChunk(delta, fullText)`
5. `LLMAdapter` 在 onChunk 中用正则提取 `<thinking>` 标签内容
6. 通过 `onThinkingUpdate(playerId, thinkingSoFar)` 推到 Zustand store
7. React 组件订阅 `llmThoughts[playerId]`，自动重渲染思考气泡

**降级**: 如果流式失败（比如 Ollama 某些版本不支持），自动回退到非流式 `callLLM()`。但超时导致的失败**不会**回退（防止超时叠加：streaming 30s + non-streaming 30s = 60s）。

**思考展示时序**: LLM 决策完成后，先将完整思考内容写入 store，然后等待 `minActionInterval`（这个等待在 LLM 返回**之后**而非并行），最后才执行行动。确保用户先看到完整思考过程。

---

## Q5: 如何保证 LLM 返回合法的扑克动作？

**回答**: 四层防御：

1. **Prompt 约束**: 只列出当前合法操作和金额范围，不列非法操作
2. **格式解析**: 正则提取 `<action>{"type":"raise","amount":200}</action>`，容错处理（找不到标签就搜 JSON）
3. **动作校验 + 模糊匹配**:
   - `bet` 和 `raise` 互相尝试（LLM 经常混用）
   - `check` 不可用时降级为 `call`
   - 金额超出范围 → clamp 到 [min, max]
   - 金额 ≥ 筹码 → 转为 `allIn`
4. **重试 + 兜底**: 第一次失败 → 发送纠错 prompt 重试 → 还是失败 → fold

实际运行中，GPT-4o 和 Claude 的首次解析成功率约 95%，加上重试后接近 100%。

---

## Q6: 边池（Side Pot）是怎么计算的？

**回答**: 标准扑克边池算法：

1. 收集所有玩家的本手总投入（`totalBetThisRound`）
2. 按投入金额**升序**排列
3. 逐级切割：每个投入级别，计算该级别所有投入者的贡献总和
4. 每个切割点产生一个 pot，**只有投入达到该级别的非弃牌玩家**才有资格赢

关键修复：我们发现原版代码的 side pot 没有排除弃牌玩家，导致弃牌后仍然有资格赢边池。修复后 `PlayerBet` 增加了 `isFolded` 字段，边池计算时排除弃牌玩家的资格。

---

## Q7: game-store 的 processNextAction 是怎么避免并发问题的？

**回答**: 三层保护：

1. **模块级互斥锁**: `let isProcessingAction = false`，进入时检查+上锁，finally 释放。递归调用前先释放锁
2. **200ms 防抖**: `playerAction()` 检查距上次操作时间，200ms 内的重复点击被忽略
3. **isBotActing 状态**: 在所有早期退出路径（showdown、waiting、非活跃玩家）都会重置为 false，防止 UI 卡在"思考中"状态
4. **全局超时控制**: LLMAdapter 使用单一 AbortController 控制整个 decide() 生命周期的总超时，streaming + retry 共享同一个 signal，不会出现超时叠加

这不是完美的并发解决方案（没有用 mutex 库），但对于单用户浏览器环境足够了。

---

## Q8: 蒙特卡洛胜率计算性能如何？会阻塞 UI 吗？

**回答**: 当前是同步计算但放在 `setTimeout(..., 0)` 中延迟执行，不阻塞渲染帧。

性能数据：
- 手牌评估器速度约 50K hands/sec（JavaScript，C(7,5)=21 组合枚举）
- 2 人 + 2000 次模拟 ≈ 40ms
- 3 人 + 2000 次模拟 ≈ 80ms
- 6 人 + 1500 次模拟 ≈ 150ms

对于实时 UI 来说可以接受（每个 street 变化时才计算一次）。如果要优化可以：
1. 移到 Web Worker 避免主线程阻塞
2. 用查表法替代组合枚举（如 Two Plus Two 算法，22M hands/sec）
3. 用 `requestIdleCallback` 调度

---

## Q9: 为什么选 Zustand 而不是 Redux 或 Context？

**回答**:
1. **体积**: Zustand 核心 ~1KB，Redux Toolkit ~30KB
2. **样板代码**: Zustand 零 boilerplate，一个 `create()` 就是一个 store
3. **React 外访问**: `useGameStore.getState()` 可以在引擎回调中使用，不需要 React context
4. **selector 性能**: 内置 selector，只有用到的状态变化才触发重渲染

具体场景：`LLMAdapter` 的 `onThinkingUpdate` 回调在 API 流式响应中被调用（非 React 上下文），用 Zustand 的 `set()` 可以直接更新状态触发 UI 重渲染，用 Context 做不到。

---

## Q10: 手牌评估器的实现原理？

**回答**: 经典组合枚举法：

1. 从 7 张牌（2 底牌 + 5 公共牌）中枚举所有 C(7,5)=21 种 5 张组合
2. 每个 5 张组合评估手牌等级（1-9：高牌到同花顺）
3. 同等级用 tiebreaker values 排序（踢脚牌）
4. 返回最强组合

评估 5 张牌的逻辑：
- 检查同花（5 张同花色）
- 检查顺子（5 张连续，含 A-2-3-4-5 小顺）
- 按点数分组计数 → 四条/葫芦/三条/两对/一对/高牌

---

## Q11: 如果面试官问"你怎么测试 LLM 相关代码"？

**回答**: LLM 代码的测试策略是**隔离 API 调用，测试前后处理**：

1. **prompt-builder**: 纯函数，输入 player+state → 输出 string。直接断言输出包含预期的牌面信息、位置、合法操作
2. **response-parser**: 纯函数，输入 LLM 回复字符串 → 输出 parsed action。覆盖：正常格式、缺少标签、JSON 格式错误、非法动作类型、金额超范围
3. **player-adapter**: mock `callLLM` 返回预设回复，验证适配器正确解析并返回 DecisionResult
4. **llm-client**: mock `fetch`，验证请求格式、超时处理、重试逻辑

当前项目有 30 个测试用例（prompt-builder 8 个、response-parser 17 个、player-adapter 5 个），全部通过。

---

## Q12: 这个项目最大的技术挑战是什么？

**回答**: **异步状态管理的复杂度**。

一个典型的行动循环涉及：
- 异步 LLM API 调用（2-30 秒，或不限制时间）
- 流式输出实时推送到 UI（优先展示 CoT 内容，而非占位符）
- LLM 返回后额外等待 minActionInterval 展示完整思考
- 行动后 0.6 秒暂停展示
- 阶段转换时的公共牌动画
- AutoPlay 时 2 秒延迟后自动下一手
- 人类玩家的不确定等待时间
- 对局结束检测 + 排名面板弹出

这些全部交织在 `processNextAction()` 中，需要：递归调用自身、互斥锁防并发、多处状态同步、错误恢复不卡死。

另一个挑战是**上下文工程** — 让 LLM 在有限 token 内做出合理的扑克决策，同时保持跨手记忆，需要精心设计 prompt 结构和印象蒸馏机制。印象系统还需要跟踪跨手变化历史（`impressionHistory`），UI 能高亮最近更新的印象。

---

## Q13: 数据存储架构是怎么设计的？为什么分三层？

**回答**: 项目没有后端，所有数据存在浏览器本地，分三层各司其职：

**第一层 — Zustand 内存 Store**（运行时状态，刷新即丢）：
- GameEngine 实例、当前牌局状态、思考气泡内容、倒计时、动画状态、实时胜率
- 这些是"过程数据"，只在游戏运行时有意义，不值得持久化

**第二层 — IndexedDB（Dexie.js）**（持久化结果，跨会话保留）：
- `apiProfiles`: LLM API 配置（endpoint、Key、模型）
- `sessions`: 场次元数据快照
- `handHistories`: 完整牌谱（含思考链、印象）
- `impressions`: LLM 对其他玩家的印象（复合主键 `[sessionId+playerId]`）

**第三层 — localStorage**（轻量偏好，同步读取）：
- 只有一个 key `poker-arena-session-config`，存座位和参数配置
- 选 localStorage 而不是 IndexedDB 的原因：数据量 <2KB、需要**同步**读取（页面打开立即恢复上次配置，不能等 async）
- `thinkingTimeout` 支持 0 表示"不限制时间"

**写入策略**是 write-through：改 Zustand 内存的同时异步写 IndexedDB，不等写完就更新 UI。写入失败采用 fire-and-forget（`catch(console.error)`），不阻断游戏进行。

**核心考量**：API Key 只存在用户本地 IndexedDB，从不经过任何中间服务器，保证隐私安全。

---

## Q14: 为什么用 Floating UI 做思考气泡定位？之前的方案有什么问题？

**回答**: 之前的方案是根据座位位置硬编码 `absolute left-full / right-full` 定位。问题：

1. **遮挡**: 固定方向的气泡可能遮挡手牌、筹码或其他 UI 元素
2. **溢出**: 屏幕边缘的座位，气泡可能超出视口
3. **维护成本**: 需要手动管理避让逻辑（如手牌根据气泡方向移动到反方向）

改用 `@floating-ui/react` 后：
- `autoPlacement` 中间件自动在 4 个方向中选择空间最大的放置气泡
- `shift` 中间件防止超出视口边界
- `offset(12)` 保持与锚点的间距
- 手牌/筹码位置完全不变，不再需要避让逻辑
- 窗口缩放时气泡自动重新计算位置

代码从 ~20 行硬编码定位逻辑简化为 ~10 行 Floating UI 配置。

---

## Q15: CORS 代理是怎么处理的？

**回答**: 浏览器直连 LLM API 会遇到 CORS 限制（大多数 API 不允许浏览器跨域请求）。解决方案分两层：

1. **开发环境**: `vite.config.ts` 配置 proxy 规则，`/api/*` 请求自动转发到目标 API
2. **生产环境**: `ops/server/proxy-server.mjs` 是一个轻量 Node.js 代理，处理 CORS headers 并转发请求

这样用户只需配置一次 API endpoint，开发和生产环境都能正常工作。
