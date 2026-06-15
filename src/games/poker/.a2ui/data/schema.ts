/**
 * 德扑配置数据 schema（Zod 4，项目顶层 zod）。
 * 与渲染器内部的 zod 3（catalog 组件 schema）边界隔离，互不干扰（spec D12）。
 */
import { z } from 'zod'

export const pokerConfigSchema = z.object({
  // TextField 绑定的值是字符串，用 coerce 转 number
  smallBlind: z.coerce.number().int().positive('小盲必须是正整数'),
  bigBlind: z.coerce.number().int().positive('大盲必须是正整数'),
  startingChips: z.coerce.number().int().positive('初始筹码必须是正整数'),
  // AgentPicker 选中的 agent id（stub 阶段可能为空，真实校验在完整 AgentPicker 接入后补）
  agentIds: z.array(z.string()).default([]),
})

export type PokerConfig = z.infer<typeof pokerConfigSchema>
