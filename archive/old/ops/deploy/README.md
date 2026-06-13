# 部署 SOP

标准操作流程：本地验证后，将代码同步到云服务器并使用 Docker Compose 重建服务。

## 本地私有文件

以下文件只保存在本地：

- `ops/private/deploy.env`
- `ops/private/puke.pem`

建议 `ops/private/deploy.env` 内容：

```bash
SSH_HOST=43.156.230.108
SSH_USER=root
SSH_PORT=22
SSH_KEY=ops/private/puke.pem
REMOTE_DIR=/opt/poker-arena
LOCAL_PORT=3000
```

## 部署前检查

```bash
npm run build
```

## Docker 本地启动

```bash
docker compose -f ops/deploy/docker-compose.yml build
docker compose -f ops/deploy/docker-compose.yml up -d
```

## 手动同步到服务器

```bash
tar --exclude=node_modules --exclude=.git --exclude=dist -czf /tmp/puke-deploy.tar.gz .
scp -i ops/private/puke.pem -P 22 -o StrictHostKeyChecking=no /tmp/puke-deploy.tar.gz root@43.156.230.108:/tmp/puke-deploy.tar.gz
ssh -i ops/private/puke.pem -p 22 -o StrictHostKeyChecking=no root@43.156.230.108 \
  'cd /opt/poker-arena && rm -rf src/ public/ ops/ docs/ && tar xzf /tmp/puke-deploy.tar.gz && docker compose -f ops/deploy/docker-compose.yml down && docker compose -f ops/deploy/docker-compose.yml up -d --build'
```

## 验证

```bash
ssh -i ops/private/puke.pem -p 22 root@43.156.230.108 \
  'docker compose -f /opt/poker-arena/ops/deploy/docker-compose.yml logs --tail 10'
```

访问：

- `http://43.156.230.108:3000`
- `http://localhost:3000`
