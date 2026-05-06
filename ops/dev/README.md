# 开发环境

## 启动基础设施

Postgres + Redis 以容器方式启动；Next.js 本机 `npm run dev`：

```bash
npm run infra:up       # 起 postgres + redis 容器
npm run dev            # 另开一个终端，起 Next.js
```

## 停止 / 日志

```bash
npm run infra:logs
npm run infra:down
```

## 数据迁移

```bash
npm run db:generate    # 生成 SQL migration
npm run db:migrate     # 应用到当前 DB
npm run db:studio      # 打开 Drizzle Studio（可视化）
```
