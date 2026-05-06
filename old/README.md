# 🃏 LLM Poker Arena — 多 AI 对战德州扑克竞技平台

让多个 LLM（大语言模型）在德州扑克牌桌上自主对弈的 Web 应用。支持 Human / Bot / LLM 混合座位，实时观看 AI 思考链（CoT），上帝视角胜率热力图，全自动 AI 竞技模式。

![React](https://img.shields.io/badge/React-19-blue)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)
![Vite](https://img.shields.io/badge/Vite-7-purple)
![TailwindCSS](https://img.shields.io/badge/TailwindCSS-4-cyan)
![Zustand](https://img.shields.io/badge/Zustand-5-orange)

## ✨ 核心特性

| 特性 | 描述 |
|------|------|
| **多 LLM 对战** | 接入任意 OpenAI 兼容 API（GPT-4o、Claude、Llama、Ollama 等），不同模型同桌竞技 |
| **实时思考链** | SSE 流式输出 LLM `<thinking>` 过程，观看 AI 分析牌面和对手 |
| **AI 竞技模式** | 全 LLM 座位时一键自动对局，连续打到决出最终胜者 |
| **对手建模** | LLM 每手结束后更新对其他玩家的"印象"，UI 高亮变化并标注更新手数 |
| **双视角** | 玩家视角（只看自己底牌）+ 上帝视角（所有底牌 + 胜率 + 思考链）|
| **完整引擎** | Heads-up 盲注、边池、raise cap、蒙特卡洛胜率、手牌评估 |
| **超时控制** | 可配置 LLM 思考超时（倒计时模式）或不限制时间（等思考链完全加载）|
| **对局管理** | 随时结束对局，排名面板展示筹码变化和盈亏 |
| **智能气泡定位** | Floating UI 自动寻找最佳方向放置思考气泡，不遮挡手牌/筹码 |
| **CORS 代理** | 内置 Node.js 代理服务器，解决浏览器直连 LLM API 的跨域问题 |
| **纯前端** | 无后端，API 调用从浏览器发起，数据存 IndexedDB |

## 🚀 快速开始

```bash
git clone <repo-url> && cd puke
npm install
npm run dev          # → http://localhost:5173
```

## 🎮 使用流程

1. **配置 API** — 添加 LLM API 端点（OpenAI、Anthropic 代理、Ollama 等）
2. **配置座位** — 6 座位分配 Human / LLM / Bot / 留空
3. **开始对局** — 玩家模式参与 or 上帝视角观战 or AI 竞技全自动
4. **复盘** — 历史页面查看完整对局日志 + LLM 思考链 + 筹码变化图

## 🏗️ 架构

```
┌─────────────────────────────────────────────────────────┐
│                   UI Layer (React 19)                    │
│  Setup / Game (Player + Spectator) / History             │
├─────────────────────────────────────────────────────────┤
│                State Layer (Zustand 5)                    │
│  app-store │ game-store │ profile-store │ session-store   │
├────────────────────┬────────────────────────────────────┤
│   Game Engine       │     LLM Integration                │
│  GameEngine 状态机  │  llm-client (streaming SSE)        │
│  Evaluator 手牌评估 │  prompt-builder (CoT 提示词)       │
│  BotAI 规则策略     │  response-parser (动作解析)        │
│  Equity 蒙特卡洛    │  impression-manager (对手建模)     │
│  PotManager 边池    │  player-adapter (决策适配器)       │
│                     │  @floating-ui/react (气泡定位)     │
├────────────────────┴────────────────────────────────────┤
│             Persistence (Dexie.js / IndexedDB)           │
└─────────────────────────────────────────────────────────┘
```

## 📁 项目结构

```
src/
├── types/              # 核心类型 + UI 类型 (ui.ts)
├── engine/             # 纯逻辑引擎（无 UI 依赖）
│   ├── game-engine.ts  #   完整德州扑克状态机
│   ├── evaluator.ts    #   手牌评估 C(7,5)
│   ├── equity.ts       #   蒙特卡洛胜率（单人/多人）
│   ├── pot-manager.ts  #   边池计算
│   ├── player-adapter.ts # Human/Bot/LLM 决策适配器
│   ├── bot/            #   规则 Bot AI
│   └── llm/            #   LLM 集成（client/prompt/parser/impressions）
├── store/              # Zustand 状态管理
├── db/                 # IndexedDB 持久层
├── components/         # UI 组件 (game/ setup/ history/ layout/)
│   └── game/           #   RankingPanel / LiveRanking / ThinkingBubble / ImpressionPanel 等
├── pages/              # 页面入口
└── hooks/              # useActionQueue 异步队列
```

## 🧪 开发

```bash
npm run dev     # HMR 开发服务器
npm run build   # tsc + vite build
npm run lint    # ESLint
npm test        # Vitest
```

## 📄 License

MIT
