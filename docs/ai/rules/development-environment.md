# 开发环境与设备复用

这份规则用于新设备初始化、日常开发前检查、部署前环境确认。目标是把“安装依赖、检查环境、同步 Git”做成可复用流程，而不是只存在某一台机器或某个 plan 里。

## 新设备初始化

克隆仓库后先运行：

```bash
npm run bootstrap
```

该命令会按顺序执行：

1. `npm run sync`：工作区干净且有 upstream 时执行 `git fetch --all --prune` + `git pull --ff-only`
2. `npm ci`：按 `package-lock.json` 安装依赖
3. `npm run doctor`：检查 Node、npm、Git、依赖、环境文件、TypeScript、Docker / Compose

如果仓库还没有 upstream，`sync` 会跳过并提示，不会修改 git remote。

## 日常开发前

开始实现前默认先运行：

```bash
npm run sync
npm run doctor
```

`sync` 是安全拉取：

- 工作区不干净时不 pull
- 当前分支没有 upstream 时不 pull
- 使用 `git pull --ff-only`，避免自动产生 merge commit
- 不修改 git config，不自动设置 remote

## 任务分支与提交节奏

本地开发建议在任务分支上推进：

```bash
git switch main
npm run sync
git switch -c feature/<scope>-<short-desc>
```

执行 plan 时按 task 边界做分步提交：

```bash
npm run commit:step -- "feat(p0): add env loader"
```

这能保证：

- 每个任务都有独立回滚点
- 换设备时可以通过 push/pull 同步完整进度
- 代码评审时能看清每一步目的
- AI 长任务中断后能从 Git 历史和 session state 共同恢复

如果当前工作区包含用户尚未整理的改动，先停下来确认，不要自动提交。

## 环境检查含义

`npm run doctor` 会检查：

- Node.js >= 22
- npm 可用
- Git 可用
- `package-lock.json` 存在
- `node_modules` 已安装
- `.env` / `.env.local` / `.env.example` 状态
- TypeScript compiler 可用
- Docker 与 Docker Compose 可用

Docker 在早期任务中可能暂时不需要；如果失败，按当前任务判断是否阻塞。

## 部署或切设备注意事项

- 优先使用 `npm ci`，不要随手 `npm install` 改 lockfile。
- 如果需要改依赖，单独提交 `package.json` 和 `package-lock.json`。
- `.env` 不入库；新设备从 `.env.example` 复制。
- 部署前至少跑 `npm run doctor` 和当前 Phase 的验证命令。
- AI 执行 plan 前，也应把 `npm run sync` 视为本能动作；但遇到未提交本地改动时必须停止同步并提示用户。
