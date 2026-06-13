/**
 * TimingParamsSection — 所有游戏共享的平台级参数配置。
 * 包含：动作间隔、LLM 超时限制、统一角色描述（预设 + 自定义）。
 * 由 PluginSetupPage / SetupPage 共同使用。
 */

import { useState, useEffect } from 'react'
import type { SessionConfig } from '../../store/session-store'

/** 预设提示词 */
const PROMPT_PRESETS = [
  {
    id: 'poker',
    label: '德州扑克专家',
    prompt: '一位世界顶级德州扑克职业选手，正在参加一场高注额生存赛，目标是筹码最大化。你的核心能力：1) 熟练结合 GTO 与剥削性打法；2) 善用诈唬、半诈唬、薄价值下注、慢打等手段；3) 每次决策综合考虑底牌胜率、位置优势、筹码底池比、底池赔率、对手范围及牌面结构。分析时先评估局势和对手范围，再计算赔率，最后给出最优行动。',
  },
  {
    id: 'doudizhu',
    label: '斗地主高手',
    prompt: '一位经验丰富的斗地主高手，精通记牌、拆牌和配合策略。作为地主善用底牌优势主动进攻，作为农民善于配合队友压制地主。每次出牌综合考虑手牌结构、剩余牌型、对手手牌数量和出牌习惯。',
  },
  {
    id: 'custom',
    label: '自定义',
    prompt: '',
  },
] as const

type PresetId = typeof PROMPT_PRESETS[number]['id']

/** 根据当前 prompt 内容判断匹配哪个预设 */
function detectPresetId(prompt: string): PresetId {
  for (const preset of PROMPT_PRESETS) {
    if (preset.id !== 'custom' && preset.prompt === prompt) return preset.id
  }
  return 'custom'
}

interface TimingParamsProps {
  config: Pick<SessionConfig, 'minActionInterval' | 'thinkingTimeout' | 'defaultSystemPrompt'>
  onUpdate: (updates: Partial<Pick<SessionConfig, 'minActionInterval' | 'thinkingTimeout' | 'defaultSystemPrompt'>>) => void
}

export function TimingParamsSection({ config, onUpdate }: TimingParamsProps) {
  const isUnlimited = config.thinkingTimeout === 0

  const [presetId, setPresetId] = useState<PresetId>(() =>
    detectPresetId(config.defaultSystemPrompt),
  )

  // 同步外部 config 变化 (如 loadConfig)
  useEffect(() => {
    setPresetId(detectPresetId(config.defaultSystemPrompt))
  }, [config.defaultSystemPrompt])

  const handlePresetChange = (id: PresetId) => {
    setPresetId(id)
    if (id !== 'custom') {
      const preset = PROMPT_PRESETS.find(p => p.id === id)
      if (preset) onUpdate({ defaultSystemPrompt: preset.prompt })
    }
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* 动作间隔 */}
      <div className="bg-surface-container-low p-5 rounded-xl space-y-3">
        <label className="text-xs font-bold uppercase tracking-widest text-on-surface-variant flex items-center gap-2">
          <span className="material-symbols-outlined text-sm">speed</span>
          动作间隔 ({(config.minActionInterval / 1000).toFixed(1)}s)
        </label>
        <input
          type="range"
          min="500"
          max="5000"
          step="500"
          value={config.minActionInterval}
          onChange={e => onUpdate({ minActionInterval: Number(e.target.value) })}
          className="w-full h-1.5 bg-surface-container-high rounded-lg appearance-none cursor-pointer accent-primary"
        />
        <div className="flex justify-between text-[10px] text-on-surface-variant uppercase font-bold">
          <span>Fast</span>
          <span>Slow</span>
        </div>
      </div>

      {/* LLM 超时限制 */}
      <div className="bg-surface-container-low p-5 rounded-xl space-y-3">
        <label className="text-xs font-bold uppercase tracking-widest text-on-surface-variant flex items-center gap-2">
          <span className="material-symbols-outlined text-sm">timer</span>
          LLM 超时限制
        </label>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <button
              onClick={() => onUpdate({ thinkingTimeout: 0 })}
              className={`flex-1 text-xs py-2 rounded font-bold transition-all ${isUnlimited ? 'bg-primary text-on-primary' : 'bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest'}`}
            >
              不限制
            </button>
            <button
              onClick={() => { if (isUnlimited) onUpdate({ thinkingTimeout: 30000 }) }}
              className={`flex-1 text-xs py-2 rounded font-bold transition-all ${!isUnlimited ? 'bg-primary text-on-primary' : 'bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest'}`}
            >
              限时
            </button>
          </div>
          {!isUnlimited && (
            <div className="relative">
              <input
                type="number"
                value={config.thinkingTimeout / 1000}
                onChange={e => {
                  const val = Number(e.target.value)
                  if (val > 0) onUpdate({ thinkingTimeout: val * 1000 })
                }}
                min={1}
                className="w-full bg-surface-container-high border-none rounded text-on-surface py-2 px-4 focus:ring-1 focus:ring-primary"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-on-surface-variant">
                SEC
              </span>
            </div>
          )}
          {isUnlimited && (
            <p className="text-[10px] text-on-surface-variant/60 text-center">
              等待思考链完全加载后再执行
            </p>
          )}
        </div>
      </div>

      {/* 统一角色描述 — 预设下拉 + 条件 textarea */}
      <div className="col-span-full bg-surface-container-low p-5 rounded-xl space-y-3">
        <label className="text-xs font-bold uppercase tracking-widest text-on-surface-variant flex items-center gap-2">
          <span className="material-symbols-outlined text-sm">description</span>
          统一角色描述
        </label>

        {/* 预设选择 */}
        <div className="flex gap-2">
          {PROMPT_PRESETS.map(p => (
            <button
              key={p.id}
              onClick={() => handlePresetChange(p.id)}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                presetId === p.id
                  ? 'bg-primary text-on-primary'
                  : 'bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* 提示词内容 */}
        {presetId === 'custom' ? (
          <textarea
            value={config.defaultSystemPrompt}
            onChange={e => onUpdate({ defaultSystemPrompt: e.target.value })}
            placeholder="所有 LLM 玩家共享的角色设定"
            rows={3}
            className="w-full bg-surface-container-high border-none rounded text-sm text-on-surface py-2 px-4 focus:ring-1 focus:ring-primary resize-y"
          />
        ) : (
          <div className="w-full bg-surface-container-high/50 rounded text-sm text-on-surface-variant py-2 px-4 leading-relaxed">
            {config.defaultSystemPrompt}
          </div>
        )}

        <p className="text-[10px] text-on-surface-variant/60">
          {presetId === 'custom'
            ? '未开启自定义角色描述的 LLM 玩家将使用此设定'
            : `已选择「${PROMPT_PRESETS.find(p => p.id === presetId)?.label}」预设`}
        </p>
      </div>
    </div>
  )
}
