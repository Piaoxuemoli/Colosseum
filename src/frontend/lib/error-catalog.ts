// Agent 错误码 → 人类可读标题/提示（FR-4.8-01）。
// ErrorBadge（观战实时）与 MatchErrorDigest（结算/回放汇总）共用。

export const ERROR_LABELS: Record<string, { title: string; hint: string }> = {
  'llm-parse_fail': {
    title: 'LLM 输出解析失败',
    hint: '模型回复里没有提取到合法动作 JSON，系统已使用规则 Bot 兜底。',
  },
  'llm-invalid-action': {
    title: 'LLM 动作不合法',
    hint: '模型给出了动作，但不符合当前可行动作集合，系统已校正或兜底。',
  },
  'llm-api-key-missing': {
    title: 'API Key 缺失',
    hint: '本局没有可用密钥，Agent 改用规则 Bot。重新上传后后续回合即可恢复 LLM 调用。',
  },
  'llm-api_error': {
    title: 'LLM 接口调用失败',
    hint: '供应商侧返回错误（鉴权失败 / 额度耗尽 / 网络异常等）。若 key 已失效，可重新上传后再战。',
  },
  'llm-profile-missing': {
    title: 'Profile 缺失',
    hint: 'Agent 绑定的模型配置不存在，系统改用规则 Bot。',
  },
  'agent-token-missing': {
    title: '对局 Token 缺失',
    hint: 'GM 无法调用 Agent endpoint，系统改用规则 Bot。',
  },
  'agent-no-action': {
    title: 'Agent 未返回动作',
    hint: 'Agent endpoint 完成但没有产出 action 字段，系统改用规则 Bot。',
  },
  'agent-endpoint-failed': {
    title: 'Agent endpoint 调用失败',
    hint: 'GM 请求 Agent endpoint 报错或超时，系统改用规则 Bot。',
  },
  'agent-invalid-action': {
    title: 'Agent 动作校验失败',
    hint: '最终动作没有通过 GM 校验，系统已执行恢复动作。',
  },
}

export const LAYER_LABELS: Record<string, string> = {
  http: 'HTTP/A2A 调用',
  structured: '结构化输出',
  parse: '动作解析',
  validate: '动作校验',
  fallback: '兜底恢复',
}

export function errorMeta(code: string): { title: string; hint: string } {
  return ERROR_LABELS[code] ?? { title: code, hint: '未知错误类型，请查看原始响应和恢复动作。' }
}
