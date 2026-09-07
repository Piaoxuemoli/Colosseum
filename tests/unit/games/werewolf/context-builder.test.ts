import { describe, it, expect } from 'vitest'
import { WerewolfPlayerContextBuilder } from '@/games/werewolf/agent/context-builder'
import type { ActionSpec } from '@/platform/engine/contracts'
import type { MemoryContextSnapshot } from '@/platform/memory/contracts'
import type { WerewolfAction } from '@/games/werewolf/engine/types'
import { makeBaseState } from './_helpers'

const builder = new WerewolfPlayerContextBuilder()

const emptyMemory: MemoryContextSnapshot = {
  workingSummary: '',
  episodicSection: '',
  semanticSection: '',
}

function build(
  state: ReturnType<typeof makeBaseState>,
  selfId: string,
  validActions: unknown[],
  memory: MemoryContextSnapshot = emptyMemory,
) {
  return builder.build({
    agent: { id: selfId, systemPrompt: '你是一个严谨的玩家。' },
    gameState: state,
    validActions,
    memoryContext: memory,
  })
}

describe('WerewolfPlayerContextBuilder — validActions 透传与 JSON 范式注入', () => {
  it('合法动作类型同时出现在 system 纪律行与 user 动作块，且附带头字段 JSON 范式', () => {
    const s = { ...makeBaseState(), phase: 'day/vote' as const, currentActor: 'v1' }
    const actions: ActionSpec<WerewolfAction>[] = [{ type: 'day/vote' }]
    const r = build(s, 'v1', actions)

    // system：type 白名单列出合法动作
    expect(r.systemMessage).toContain('"day/vote"')
    expect(r.systemMessage).not.toContain('"day/speak"')

    // user：动作块给出可照填的 JSON 范式（历史 bug：漏注入导致 llm-invalid-action）
    expect(r.userMessage).toContain('## 本阶段合法动作')
    expect(r.userMessage).toContain('- day/vote：{"type":"day/vote","targetId":"<活人 agentId 或 null>","reason":"简短理由"}')
  })

  it('每个合法动作注入各自正确的 schema（六种类型逐一核对）', () => {
    const s = { ...makeBaseState(), phase: 'day/speak' as const, currentActor: 'v1' }
    const actions: ActionSpec<WerewolfAction>[] = [
      { type: 'day/speak' },
      { type: 'night/werewolfKill' },
      { type: 'night/seerCheck' },
      { type: 'night/witchSave' },
      { type: 'night/witchPoison' },
      { type: 'day/vote' },
    ]
    const r = build(s, 'v1', actions)
    expect(r.userMessage).toContain(
      '- day/speak：{"type":"day/speak","content":"你的发言（≤200字）","claimedRole":"werewolf|seer|witch|villager"}',
    )
    expect(r.userMessage).toContain(
      '- night/werewolfKill：{"type":"night/werewolfKill","targetId":"<活人 agentId>","reasoning":"简短理由"}',
    )
    expect(r.userMessage).toContain('- night/seerCheck：{"type":"night/seerCheck","targetId":"<非自身活人 agentId>"}')
    expect(r.userMessage).toContain('- night/witchSave：{"type":"night/witchSave"}')
    expect(r.userMessage).toContain(
      '- night/witchPoison：{"type":"night/witchPoison","targetId":"<活人 agentId 或 null>"}',
    )
    expect(r.userMessage).toContain('- day/vote：{"type":"day/vote","targetId":"<活人 agentId 或 null>","reason":"简短理由"}')
  })

  it('未知动作类型回落到最简 schema，不让动作块缺失格式提示', () => {
    const s = { ...makeBaseState(), phase: 'day/speak' as const, currentActor: 'v1' }
    const r = build(s, 'v1', [{ type: 'day/execute' }])
    expect(r.userMessage).toContain('- day/execute：{"type":"day/execute"}')
  })

  it('label 附加在动作类型后', () => {
    const s = { ...makeBaseState(), phase: 'night/werewolfDiscussion' as const, currentActor: 'w1' }
    const r = build(s, 'w1', [{ type: 'day/speak', label: '狼人讨论' }])
    expect(r.userMessage).toContain('- day/speak（狼人讨论）：')
  })

  it('validActions 为空 → 动作块显示（无）；null 项被过滤', () => {
    const s = { ...makeBaseState(), phase: 'day/speak' as const, currentActor: 'v1' }
    const r = build(s, 'v1', [])
    expect(r.userMessage).toContain('## 本阶段合法动作')
    expect(r.userMessage).toMatch(/（无）\n/)
    const withNull = build(s, 'v1', [null, { type: 'day/speak' }])
    expect(withNull.userMessage.split('- day/speak：').length - 1).toBe(1) // null 项被过滤，不产生多余条目
  })

  it('输出契约提示包含 <thinking> 与 <action> 标签说明', () => {
    const s = { ...makeBaseState(), phase: 'day/speak' as const, currentActor: 'v1' }
    const r = build(s, 'v1', [{ type: 'day/speak' }])
    expect(r.systemMessage).toContain('<thinking>')
    expect(r.systemMessage).toContain('<action>')
  })
})

describe('WerewolfPlayerContextBuilder — 私有信息按角色分发', () => {
  it('狼人看到狼队友名单', () => {
    const s = { ...makeBaseState(), phase: 'night/werewolfDiscussion' as const, currentActor: 'w1' }
    const r = build(s, 'w1', [{ type: 'day/speak' }])
    expect(r.systemMessage).toContain('真实身份：狼人')
    expect(r.systemMessage).toContain('你的狼队友：w2')
  })

  it('预言家看到历次验人结果', () => {
    const s = {
      ...makeBaseState(),
      phase: 'night/seerCheck' as const,
      currentActor: 's',
      seerCheckResults: [
        { day: 0, targetId: 'v1', role: 'werewolf' as const },
        { day: 1, targetId: 'v2', role: 'villager' as const },
      ],
    }
    const r = build(s, 's', [{ type: 'night/seerCheck' }])
    expect(r.systemMessage).toContain('真实身份：预言家')
    expect(r.systemMessage).toContain('第0天查 v1 = 狼人')
    expect(r.systemMessage).toContain('第1天查 v2 = 平民')
  })

  it('女巫看到药剂存量', () => {
    const s = {
      ...makeBaseState(),
      phase: 'night/witchAction' as const,
      currentActor: 'wi',
      witchPotions: { save: true, poison: false },
    }
    const r = build(s, 'wi', [{ type: 'night/witchPoison' }])
    expect(r.systemMessage).toContain('真实身份：女巫')
    expect(r.systemMessage).toContain('救药 剩')
    expect(r.systemMessage).toContain('毒药 已用')
  })

  it('平民无特殊能力提示，且不泄露任何私有信息', () => {
    const s = { ...makeBaseState(), phase: 'day/speak' as const, currentActor: 'v1' }
    const r = build(s, 'v1', [{ type: 'day/speak' }])
    expect(r.systemMessage).toContain('真实身份：平民')
    expect(r.systemMessage).toContain('无特殊能力')
    expect(r.systemMessage).not.toContain('狼队友')
    expect(r.systemMessage).not.toContain('验人结果')
    expect(r.systemMessage).not.toContain('救药')
  })

  it('无角色（旁观察者）显示未知身份', () => {
    const s = { ...makeBaseState(), phase: 'day/speak' as const, currentActor: 'v1' }
    const r = build(s, 'ghost', [])
    expect(r.systemMessage).toContain('真实身份：未知')
  })
})

describe('WerewolfPlayerContextBuilder — 公共状态渲染', () => {
  it('user 消息包含天数、阶段、活人（id+名字）与死者（死亡日/死因）', () => {
    const base = makeBaseState()
    const s = {
      ...base,
      day: 2,
      phase: 'day/speak' as const,
      currentActor: 'v1',
      players: base.players.map((p) =>
        p.agentId === 'v2'
          ? { ...p, alive: false, deathDay: 1, deathCause: 'werewolfKill' as const }
          : p,
      ),
    }
    const r = build(s, 'v1', [{ type: 'day/speak' }])
    expect(r.userMessage).toContain('第 2 天')
    expect(r.userMessage).toContain('阶段 day/speak')
    expect(r.userMessage).toContain('w1(W1)')
    expect(r.userMessage).toContain('v2(第1天 werewolfKill)') // 死者按 id + 死亡日/死因列出
    expect(r.userMessage).not.toMatch(/死亡：\s*（无）/)
  })

  it('最近发言与历史投票带出（含自称角色与弃票）', () => {
    const s = {
      ...makeBaseState(),
      phase: 'day/vote' as const,
      currentActor: 'v1',
      day: 1,
      speechLog: [
        { day: 1, agentId: 's', content: '我验了 w1 是狼', claimedRole: 'seer' as const, at: 1 },
      ],
      voteLog: [{ day: 1, voter: 'w1', target: null, reason: '观望', at: 2 }],
    }
    const r = build(s, 'v1', [{ type: 'day/vote' }])
    expect(r.userMessage).toContain('- [Day1] s（自称预言家）：我验了 w1 是狼')
    expect(r.userMessage).toContain('- [Day1] w1 → 弃票')
  })

  it('名字缺失时回落到 agentId 展示', () => {
    const base = makeBaseState()
    const s = {
      ...base,
      phase: 'day/speak' as const,
      currentActor: 'v1',
      players: base.players.map((p) => (p.agentId === 'w1' ? { ...p, name: '' } : p)),
    }
    const r = build(s, 'v1', [{ type: 'day/speak' }])
    expect(r.userMessage).toContain('w1(w1)')
  })
})

describe('WerewolfPlayerContextBuilder — 记忆注入', () => {
  it('semantic 与 episodic 段落存在时注入 system 消息', () => {
    const s = { ...makeBaseState(), phase: 'day/speak' as const, currentActor: 'v1' }
    const r = build(s, 'v1', [{ type: 'day/speak' }], {
      workingSummary: '',
      episodicSection: '- 上局狼胜',
      semanticSection: '- w1 倾向激进发言',
    })
    expect(r.systemMessage).toContain('- w1 倾向激进发言')
    expect(r.systemMessage).toContain('- 上局狼胜')
  })

  it('记忆为空时显示（无历史）占位', () => {
    const s = { ...makeBaseState(), phase: 'day/speak' as const, currentActor: 'v1' }
    const r = build(s, 'v1', [{ type: 'day/speak' }])
    expect(r.systemMessage).toContain('（无历史）')
  })

  it('persona systemPrompt 置于 system 消息开头', () => {
    const s = { ...makeBaseState(), phase: 'day/speak' as const, currentActor: 'v1' }
    const r = builder.build({
      agent: { id: 'v1', systemPrompt: 'PERSONA_LINE' },
      gameState: s,
      validActions: [],
      memoryContext: emptyMemory,
    })
    expect(r.systemMessage.startsWith('PERSONA_LINE')).toBe(true)
  })
})
