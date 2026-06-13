# Ops 目录说明

这个目录集中存放仓库内需要保留的运维、部署与 API 相关资料，避免散落在根目录和 `docs/` 下。

## 目录约定

- `ops/deploy/`：Docker、Compose、部署脚本、部署 SOP
- `ops/server/`：生产环境用的 Node 代理服务
- `ops/api/`：可提交的 API 配置模板与说明
- `ops/private/`：本地私有文件（已加入 `.gitignore`，不提交真实密钥）

## 私有文件约定

以下真实文件仅保存在本地，不进入 Git：

- `ops/private/deploy.env`
- `ops/private/puke.pem`
- `ops/private/llm-api-config.local.md`

## 本次整理记录

- 将部署文件统一收敛到 `ops/`
- 将 API 配置改为“模板入库、真实密钥本地保存”
- 清理一次性分析、审计、调试与打包产物
