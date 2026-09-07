# Werewolf 前端 — 实施 Plan

- Spec：`docs/superpowers/specs/2026-06-16-werewolf-frontend-design.md`
- 分支：`feature/werewolf-frontend`

## Goal
补齐狼人杀观战前端三缺口：思考气泡、死亡跟踪、右侧 tab 适配；复用扑克三块布局。

## Architecture summary
镜像扑克：SpectatorView(werewolf 分支) → WerewolfBoard(3列) + RightPanel(gameType 感知 tab) + WerewolfResultPanel。数据：SSE→reduceMatchViewEvent→store.werewolf；thinking→thinking-store.current。

## Tech stack
React + Next App Router + Tailwind + shadcn/Radix + framer-motion + zustand + lucide-react。无新依赖。

## Files
- 新建：`src/frontend/components/match/ThinkingBubble.tsx`（从 poker/ui 移入）、`src/frontend/components/match/use-thinking-bubble.ts`
- 改：`src/games/poker/ui/PlayerSeat.tsx`（import 路径）、`src/games/werewolf/ui/PlayerCard.tsx`（thinking+气泡）、`WerewolfBoard.tsx`（alive/thinking）、`ModeratorPanel.tsx`（出局名单）
- 新建：`src/games/werewolf/ui/WerewolfStatusPanel.tsx`、`WerewolfRoster.tsx`
- 改：`src/frontend/components/match/RightPanel.tsx`（gameType tab）、`src/backend/orchestrator/werewolf-hooks.ts`（deaths 载荷）、`src/frontend/store/match-view-store.ts`（werewolf.deaths）

## Task steps
- [x] T1: 监控布局 + 页面结构 spec
- [x] T2: ThinkingBubble 移共享 + useThinkingBubble hook；PlayerSeat import 改
- [x] T3: PlayerCard 加 thinking + 气泡 + "思考中"药丸；WerewolfBoard 读 thinking-store 传入
- [x] T4: werewolf-hooks deaths 载荷；store werewolf.deaths；WerewolfBoard alive 推导；ModeratorPanel 出局名单
- [x] T5: WerewolfStatusPanel + WerewolfRoster；RightPanel gameType tab（隐藏 chart，rank→名册）
- [x] T6: 验证 lint/typecheck/build 全绿；reducer smoke（check:werewolf-ui）11/11 绿
- [x] T7: session-state/MEMORY 更新；分步提交；交付报告

## Validation commands
```bash
npm run lint
npm run typecheck
npm run build
npm run check          # 含 check:werewolf（引擎闭环，确保未回退）
```

## Done definition
- 气泡/死亡/状态面板/名册/tab 适配落地；lint/typecheck/build 全绿；check:werewolf 仍绿；
- session-state/MEMORY 更新；交付报告 → 结束。

## SDK drift notes
无。纯前端，无新 SDK。复用既有 zustand/framer-motion/Radix。
