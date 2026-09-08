/**
 * FR-4.7-01 解说旁白总闸（R2-2）。
 *
 * `narrationEnabled` 随对局创建 payload 进入 `matches.config` JSON 列
 * （见 `src/app/api/matches/route.ts` 的 POST 分支：顶层字段或 config 内
 * 字段均可，顶层优先）。GM tick 从 `match.config` 读取并据此决定是否跳过
 * LLM 主持人的解说性旁白。
 *
 * 语义（向后兼容）：
 * - 字段缺省 / undefined / true → 开启旁白（存量对局行为不变）。
 * - 仅显式布尔 `false` 关闭；其余杂值（字符串 'false'、0 等）一律视为开启，
 *   避免 JSON 反序列化意外把旁白关掉。
 *
 * 注意：关掉的是「解说性旁白」；狼人杀的流程性宣告（阶段切换、死亡公示）
 * 属规则必需，不受本开关影响——engine2 的 announce 阶段事件（spec
 * docs/specs/engine2-integration.md §5）即承担该职责。
 */

export type NarrationGateConfig = Record<string, unknown> | null | undefined

/** True → 主持人解说旁白开启；false → 仅跳过 LLM 解说，流程宣告照发。 */
export function isNarrationEnabled(config: NarrationGateConfig): boolean {
  return config?.narrationEnabled !== false
}
