import { describe, it, expect } from 'vitest'
import { WerewolfResponseParser } from '@/games/werewolf/agent/response-parser'
import { parseModeratorResponse } from '@/games/werewolf/agent/moderator-parser'
import type { WerewolfAction } from '@/games/werewolf/engine/types'

const parser = new WerewolfResponseParser()

function parse(raw: string) {
  return parser.parse(raw, [])
}

/** 兜底动作的固定形态：合成的 day/speak 跳过发言。 */
const FALLBACK: WerewolfAction = { type: 'day/speak', content: '（解析失败，跳过本次发言）' }

describe('WerewolfResponseParser — 正常解析', () => {
  it('thinking + action 双标签完整解析', () => {
    const r = parse(
      '<thinking>v1 最可疑</thinking>\n<action>{"type":"day/vote","targetId":"v1"}</action>',
    )
    expect(r.thinking).toBe('v1 最可疑')
    expect(r.action).toEqual({ type: 'day/vote', targetId: 'v1', reason: undefined })
    expect(r.fallbackUsed).toBe(false)
  })

  it('缺失 thinking 标签时 thinking 为空串，动作仍正常', () => {
    const r = parse('<action>{"type":"day/speak","content":"我是好人"}</action>')
    expect(r.thinking).toBe('')
    expect(r.action).toEqual({ type: 'day/speak', content: '我是好人', claimedRole: undefined })
    expect(r.fallbackUsed).toBe(false)
  })

  it('标签大小写不敏感、容忍标签带属性', () => {
    const r = parse('<THINKING>x</THINKING><Action data-x="1">{"type":"night/witchSave"}</Action>')
    expect(r.thinking).toBe('x')
    expect(r.action).toEqual({ type: 'night/witchSave' })
    expect(r.fallbackUsed).toBe(false)
  })

  it('reasoning / reason 字段可选透传', () => {
    const kill = parse(
      '<action>{"type":"night/werewolfKill","targetId":"v2","reasoning":"边位试探"}</action>',
    )
    expect(kill.action).toEqual({
      type: 'night/werewolfKill',
      targetId: 'v2',
      reasoning: '边位试探',
    })
    const vote = parse('<action>{"type":"day/vote","targetId":null,"reason":"没有信息"}</action>')
    expect(vote.action).toEqual({ type: 'day/vote', targetId: null, reason: '没有信息' })
  })

  it('witchPoison 显式 null 与字符串 targetId 均可解析', () => {
    expect(parse('<action>{"type":"night/witchPoison","targetId":null}</action>').action).toEqual({
      type: 'night/witchPoison',
      targetId: null,
    })
    expect(parse('<action>{"type":"night/witchPoison","targetId":"w1"}</action>').action).toEqual({
      type: 'night/witchPoison',
      targetId: 'w1',
    })
  })

  it('claimedRole 仅接受四个合法角色，其余归一为 undefined', () => {
    expect(
      parse('<action>{"type":"day/speak","content":"hi","claimedRole":"seer"}</action>').action,
    ).toEqual({ type: 'day/speak', content: 'hi', claimedRole: 'seer' })
    expect(
      parse('<action>{"type":"day/speak","content":"hi","claimedRole":"captain"}</action>').action,
    ).toEqual({ type: 'day/speak', content: 'hi', claimedRole: undefined })
    expect(
      parse('<action>{"type":"day/speak","content":"hi","claimedRole":42}</action>').action,
    ).toEqual({ type: 'day/speak', content: 'hi', claimedRole: undefined })
  })

  it('day/speak 超长内容被截断到 200 字（与 validator 上限一致）', () => {
    const raw = `<action>${JSON.stringify({ type: 'day/speak', content: 'x'.repeat(500) })}</action>`
    const action = parse(raw).action as { type: string; content: string }
    expect(action.type).toBe('day/speak')
    expect(action.content).toHaveLength(200)
  })
})

describe('WerewolfResponseParser — 失败回退', () => {
  it('缺少 <action> 标签 → 合成跳过发言，fallbackUsed=true', () => {
    const r = parse('<thinking>只有思考</thinking>')
    expect(r).toMatchObject({ action: FALLBACK, thinking: '只有思考', fallbackUsed: true })
  })

  it('空字符串 / 纯文本 → 回退', () => {
    expect(parse('')).toMatchObject({ action: FALLBACK, fallbackUsed: true })
    expect(parse('我觉得 v1 是狼')).toMatchObject({ action: FALLBACK, fallbackUsed: true })
  })

  it('action 内非法 JSON → 回退（保留 thinking）', () => {
    const r = parse('<thinking>推理</thinking><action>{not-json</action>')
    expect(r).toMatchObject({ action: FALLBACK, thinking: '推理', fallbackUsed: true })
  })

  it('action JSON 是数组 / 字符串 / 缺 type → 回退', () => {
    expect(parse('<action>[1,2]</action>').fallbackUsed).toBe(true)
    expect(parse('<action>"day/vote"</action>').fallbackUsed).toBe(true)
    expect(parse('<action>{"targetId":"v1"}</action>').fallbackUsed).toBe(true)
    expect(parse('<action>{"type":42}</action>').fallbackUsed).toBe(true)
  })

  it('嵌套 action 字段（{"action":{...}}）不被展开 → 回退', () => {
    const r = parse('<action>{"action":{"type":"day/vote","targetId":"v1"}}</action>')
    expect(r.fallbackUsed).toBe(true)
    expect(r.action).toEqual(FALLBACK)
  })

  it('markdown 代码围栏包裹的 JSON 无法被 JSON.parse → 回退（当前无围栏救援）', () => {
    const fenced = '<action>\n```json\n{"type":"day/vote","targetId":"v1"}\n```\n</action>'
    const r = parse(fenced)
    expect(r.fallbackUsed).toBe(true)
    expect(r.action).toEqual(FALLBACK)
  })

  it('未知动作类型 → 回退', () => {
    expect(parse('<action>{"type":"day/dance"}</action>').fallbackUsed).toBe(true)
  })

  it('各类型缺少必填字段 → 回退', () => {
    expect(parse('<action>{"type":"night/werewolfKill"}</action>').fallbackUsed).toBe(true)
    expect(parse('<action>{"type":"night/werewolfKill","targetId":7}</action>').fallbackUsed).toBe(true)
    expect(parse('<action>{"type":"night/seerCheck"}</action>').fallbackUsed).toBe(true)
    expect(parse('<action>{"type":"day/speak"}</action>').fallbackUsed).toBe(true)
    expect(parse('<action>{"type":"day/vote","targetId":13}</action>').fallbackUsed).toBe(true)
    expect(parse('<action>{"type":"night/witchPoison","targetId":true}</action>').fallbackUsed).toBe(
      true,
    )
  })

  it('<action> 未闭合（无结束标签）→ 回退', () => {
    const r = parse('<thinking>x</thinking><action>{"type":"day/vote","targetId":"v1"}')
    expect(r.fallbackUsed).toBe(true)
  })

  it('回退动作本身能通过 day/speak 阶段的 validator 约束（≤200 字）', () => {
    const content = (parse('garbage').action as { content: string }).content
    expect(content.length).toBeLessThanOrEqual(200)
    expect(content.length).toBeGreaterThan(0)
  })
})

describe('parseModeratorResponse', () => {
  it('正常 <narration> 标签：去掉首尾空白，无 error', () => {
    const r = parseModeratorResponse('<narration>\n天黑请闭眼。\n</narration>')
    expect(r).toEqual({ narration: '天黑请闭眼。' })
  })

  it('标签缺失：整段文本截断到 80 字并标记 error', () => {
    const raw = 'x'.repeat(200)
    const r = parseModeratorResponse(raw)
    expect(r).toEqual({ narration: 'x'.repeat(80), error: 'narration-tag-missing' })
  })

  it('超过 120 字：截断到 120 并标记 too-long', () => {
    const raw = `<narration>${'y'.repeat(150)}</narration>`
    const r = parseModeratorResponse(raw)
    expect(r.narration).toHaveLength(120)
    expect(r.error).toBe('too-long')
  })

  it('恰好 120 字：不截断、无 error；121 字触发截断', () => {
    expect(parseModeratorResponse(`<narration>${'z'.repeat(120)}</narration>`).error).toBeUndefined()
    const over = parseModeratorResponse(`<narration>${'z'.repeat(121)}</narration>`)
    expect(over.error).toBe('too-long')
    expect(over.narration).toHaveLength(120)
  })

  it('标签大小写不敏感且容忍属性；只取第一处标签内容', () => {
    const r = parseModeratorResponse('<Narration lang="zh">第一段</Narration>多余<narration>第二段</narration>')
    expect(r.narration).toBe('第一段')
  })

  it('空标签内容 → 空 narration（不报错）', () => {
    expect(parseModeratorResponse('<narration>   </narration>')).toEqual({ narration: '' })
  })

  it('正文里有其他标签不影响提取', () => {
    const r = parseModeratorResponse('<thinking>内心戏</thinking><narration>白天到了。</narration>')
    expect(r).toEqual({ narration: '白天到了。' })
  })
})
