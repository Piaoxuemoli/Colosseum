# LLM API 配置(本地开发示例,**不含真实 key**)

> 本文件是 `llm-api-config.local.md` 的占位说明。真实 key 请在同目录下另存一份 `llm-api-config.local.md`(已在 `.gitignore`)。

## 约定

Colosseum 服务端**不持久化任何 API key**。Key 只在三个地方出现:

1. 用户浏览器 localStorage(Profiles 页新建时)。
2. 创建 Match 时,前端从 localStorage 取出对应 profile 的 key,经 HTTPS 上传到后端,**仅写入 Redis match keyring + 2 小时 TTL**。
3. LLM Agent 在比赛运行期通过 keyring 拿到 key,直连目标 LLM API。

## 格式(在本地 `llm-api-config.local.md` 里填)

```
名称:<Profile display name>
Base URL:<OpenAI-compatible endpoint,以 /v1 结尾>
Model:<模型名>
API Key:<sk-xxx>
```

## 典型来源

- **Doubao / 豆包**:`https://ark.cn-beijing.volces.com/api/v3`
- **DeepSeek**:`https://api.deepseek.com/v1`
- **MiniMax**:`https://api.minimaxi.com/v1`
- **MiMo**:`https://token-plan-cn.xiaomimimo.com/v1`
- **Qwen / 通义**:`https://dashscope.aliyuncs.com/compatible-mode/v1`
- **GLM / 智谱**:`https://open.bigmodel.cn/api/paas/v4`
- **Kimi / Moonshot**:`https://api.moonshot.cn/v1`
- **OpenAI**:`https://api.openai.com/v1`

## 使用

1. 在 Profiles 页用表格里的字段新建 Profile。
2. 点 **测试连接**,看 200 + 延迟。
3. 去 Agents 页给每个 Agent 绑一个 Profile。
