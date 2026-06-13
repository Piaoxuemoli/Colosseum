import type { SessionConfig } from '../../store/session-store'
import { TimingParamsSection } from './TimingParams'

interface GameParamsProps {
  config: SessionConfig
  onUpdate: (updates: Partial<Omit<SessionConfig, 'seats'>>) => void
}

/**
 * GameParamsSection — 德扑 SetupPage 专用。
 * 前两行放德扑特有字段（注额、初始筹码），后面复用 TimingParamsSection。
 */
export function GameParamsSection({ config, onUpdate }: GameParamsProps) {
  return (
    <div className="space-y-6">
      {/* 德扑特有参数 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* 注额 (小注/大注) */}
        <div className="bg-surface-container-low p-5 rounded-xl space-y-3">
          <label className="text-xs font-bold uppercase tracking-widest text-on-surface-variant flex items-center gap-2">
            <span className="material-symbols-outlined text-sm">toll</span>
            注额 (小注/大注)
          </label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={config.smallBlind}
              onChange={e => onUpdate({ smallBlind: Number(e.target.value) })}
              className="w-full bg-surface-container-high border-none rounded text-center text-on-surface py-2 focus:ring-1 focus:ring-primary"
            />
            <span className="text-outline-variant">/</span>
            <input
              type="number"
              value={config.bigBlind}
              onChange={e => onUpdate({ bigBlind: Number(e.target.value) })}
              className="w-full bg-surface-container-high border-none rounded text-center text-on-surface py-2 focus:ring-1 focus:ring-primary"
            />
          </div>
          <p className="text-[10px] text-on-surface-variant/60 text-center">
            小盲 = 小注÷2，大盲 = 小注
          </p>
        </div>

        {/* 默认初始筹码 */}
        <div className="bg-surface-container-low p-5 rounded-xl space-y-3">
          <label className="text-xs font-bold uppercase tracking-widest text-on-surface-variant flex items-center gap-2">
            <span className="material-symbols-outlined text-sm">payments</span>
            默认初始筹码
          </label>
          <input
            type="number"
            value={config.defaultChips}
            onChange={e => onUpdate({ defaultChips: Number(e.target.value) })}
            className="w-full bg-surface-container-high border-none rounded text-on-surface py-2 px-4 focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      {/* 共享平台参数 (动作间隔 + LLM超时 + 角色描述) */}
      <TimingParamsSection config={config} onUpdate={onUpdate} />
    </div>
  )
}
