# Vision Router MCP Server 实施计划

## 目标

创建一个简化版的 MCP Server，基于 [mimo-media-recognition-mcp](https://github.com/congxxx/mimo-media-recognition-mcp) 设计，仅支持图片分析功能。用于在 Claude Code 中自动路由视觉任务到 MIMO 多模态模型，避免主模型因不支持多模态而崩溃。

## 架构设计

```
用户输入（含图片）
        ↓
[Claude Code 拦截层]
        ↓
[MCP Tool: understand_image]
        ↓
[MIMO API (mimo-v2-omni)]  ← 调用小米多模态模型
        ↓
[格式化输出]  ← 纯文本 + 结构化 JSON
        ↓
[主模型]  ← 只收到文字，永不接触图片
```

## 项目结构

```
mcp-servers/
└── vision-router/
    ├── src/
    │   └── vision_router_mcp/
    │       ├── __init__.py
    │       ├── server.py          # MCP Server 主逻辑
    │       ├── config.py          # 配置管理
    │       ├── models.py          # Pydantic 数据模型
    │       └── utils.py           # 工具函数
    ├── tests/
    │   ├── __init__.py
    │   ├── test_server.py         # 单元测试
    │   └── test_config.py         # 配置测试
    ├── pyproject.toml             # Python 项目配置
    ├── README.md                  # 使用文档
    └── .env.example               # 环境变量示例
```

## 实施步骤

### Step 1: 项目初始化
- 创建 `mcp-servers/vision-router/` 目录结构
- 创建 `pyproject.toml` 配置文件
- 创建 `.env.example` 环境变量示例

### Step 2: 配置管理模块
- 实现 `config.py`
- 从环境变量读取配置
- 支持的配置项：
  - `MIMO_API_KEY` (必需)
  - `MIMO_API_BASE` (必需)
  - `MIMO_MODEL` (必需，默认 `mimo-v2-omni`)
  - `MIMO_MAX_IMAGE_SIZE_MB` (可选，默认 20)
  - `MIMO_MAX_IMAGES` (可选，默认 6)

### Step 3: 数据模型定义
- 实现 `models.py`
- 定义输入/输出的 Pydantic 模型
- 严格的输入验证

### Step 4: 核心工具函数
- 实现 `utils.py`
- MIME 类型检测
- 本地文件转 base64
- URL 验证

### Step 5: MCP Server 主逻辑
- 实现 `server.py`
- 定义 `understand_image` 工具
- 实现 API 调用逻辑（带重试）
- 格式化输出

### Step 6: 测试
- 编写单元测试
- 测试配置加载
- 测试文件处理
- 测试 API 调用

### Step 7: 文档和集成
- 编写 README.md
- 添加 Claude Code 集成说明
- 添加调试指南

## 关键设计决策

### 1. 输入格式
```python
class ImageInput(BaseModel):
    image_path: str | None = None      # 本地文件路径
    image_url: str | None = None       # 远程 URL
    image_paths: list[str] | None = None  # 多个本地文件
    image_urls: list[str] | None = None   # 多个远程 URL
```

### 2. 输出格式
```json
{
  "success": true,
  "analysis": {
    "description": "图片描述...",
    "objects": ["对象1", "对象2"],
    "text_content": "OCR 识别的文字",
    "scene": "场景描述",
    "details": "其他细节"
  },
  "metadata": {
    "model": "mimo-v2-omni",
    "processing_time_ms": 1234,
    "tokens_used": 456
  }
}
```

### 3. 错误处理
```json
{
  "success": false,
  "error": "File not found: /path/to/image.png",
  "error_type": "file_not_found"
}
```

### 4. 重试策略
- 最多重试 3 次
- 指数退避：2s, 4s, 8s
- 超时时间：180s

## 依赖项

```toml
[project]
dependencies = [
    "mcp>=1.0.0",
    "httpx>=0.27.0",
    "tenacity>=8.0.0",
    "pydantic>=2.0.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0.0",
    "pytest-asyncio>=0.23.0",
]
```

## Claude Code 集成

### 安装方式
```bash
cd mcp-servers/vision-router
pip install -e .
```

### 配置方式
```bash
claude mcp add vision-router --scope user \
  --env MIMO_API_KEY="your-key" \
  --env MIMO_API_BASE="https://api.xiaomimimo.com/v1" \
  --env MIMO_MODEL="mimo-v2-omni" \
  -- "python" -m vision_router_mcp.server
```

### 使用方式
当用户输入包含图片时，Claude Code 会自动调用 `understand_image` 工具，返回纯文本结果给主模型。

## 验证标准

1. **功能验证**
   - 能正确读取本地图片文件
   - 能正确处理远程 URL
   - 能正确调用 MIMO API
   - 能正确返回结构化结果

2. **错误处理验证**
   - 文件不存在时返回清晰错误
   - 文件过大时返回清晰错误
   - API 调用失败时重试并返回错误

3. **集成验证**
   - Claude Code 能正确加载 MCP Server
   - 工具能被正确调用
   - 返回结果能被主模型正确解析

## 风险和注意事项

1. **API Key 安全**
   - 不要将 API Key 提交到代码库
   - 使用环境变量或 `.env` 文件

2. **文件大小限制**
   - 单张图片最大 20MB
   - 单次最多 6 张图片

3. **超时处理**
   - API 调用超时 180 秒
   - 大图片处理可能需要更长时间

4. **模型兼容性**
   - 确保 MIMO API 端点支持 OpenAI 兼容格式
   - 确保模型名称正确

## 时间估算

- Step 1-2: 30 分钟
- Step 3-4: 45 分钟
- Step 5: 60 分钟
- Step 6: 45 分钟
- Step 7: 30 分钟

**总计: 约 3.5 小时**

## 后续扩展

1. **音频支持** (如果需要)
   - 添加 `understand_audio` 工具
   - 支持 MP3, WAV, M4A 等格式

2. **视频支持** (如果需要)
   - 添加 `understand_video` 工具
   - 支持 MP4, MOV 等格式

3. **批量处理**
   - 支持批量图片分析
   - 并发处理优化

4. **缓存机制**
   - 缓存已分析的图片结果
   - 减少重复 API 调用
