import { useState } from 'react'
import type { APIProfile } from '../../agent/llm-client'
import { testConnection } from '../../agent/llm-client'

interface ApiConfigCardProps {
  profile: APIProfile
  onEdit: () => void
  onDelete: () => void
}

export function ApiConfigCard({ profile, onEdit, onDelete }: ApiConfigCardProps) {
  const [status, setStatus] = useState<'idle' | 'testing' | 'connected' | 'error'>('idle')

  const [testError, setTestError] = useState<string | null>(null)

  async function handleTest() {
    setStatus('testing')
    setTestError(null)
    const result = await testConnection(profile)
    setStatus(result.ok ? 'connected' : 'error')
    if (!result.ok) {
      // Extract readable message from API error JSON if possible
      const raw = result.error || '连接失败'
      let readable = raw
      try {
        const match = raw.match(/"message"\s*:\s*"([^"]+)"/)
        if (match) readable = match[1]
      } catch { /* keep raw */ }
      setTestError(readable)
    }
    // Reset after 8 seconds
    setTimeout(() => { setStatus('idle'); setTestError(null) }, 8000)
  }

  return (
    <div className="flex-shrink-0 w-72 p-5 bg-surface-container-low rounded-xl border-l-4 border-primary shadow-lg group hover:bg-surface-container transition-colors">
      <div className="flex justify-between items-start mb-4">
        <div className="h-10 w-10 bg-surface-container-high rounded flex items-center justify-center">
          <span className="material-symbols-outlined text-primary">neurology</span>
        </div>
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={handleTest} className="p-1 hover:text-primary" title="测试连接">
            <span className="material-symbols-outlined text-sm">
              {status === 'testing' ? 'sync' : 'wifi_tethering'}
            </span>
          </button>
          <button onClick={onEdit} className="p-1 hover:text-primary">
            <span className="material-symbols-outlined text-sm">edit</span>
          </button>
          <button onClick={onDelete} className="p-1 hover:text-error">
            <span className="material-symbols-outlined text-sm">delete</span>
          </button>
        </div>
      </div>
      <h3 className="font-headline font-bold text-on-surface">{profile.name}</h3>
      <p className="text-xs text-on-surface-variant mb-3 font-mono">{profile.model}</p>
      <div className="flex items-center justify-between mt-auto">
        <span className="text-[10px] uppercase tracking-widest text-on-surface-variant truncate max-w-[140px]">
          {profile.baseURL.replace(/^https?:\/\//, '')}
        </span>
        <div className="flex items-center gap-1.5">
          <span
            className={`w-2 h-2 rounded-full ${
              status === 'connected' ? 'bg-primary animate-pulse' :
              status === 'error' ? 'bg-error' :
              status === 'testing' ? 'bg-secondary animate-spin' :
              'bg-outline-variant'
            }`}
          />
          <span
            className={`text-[10px] font-bold uppercase ${
              status === 'connected' ? 'text-primary' :
              status === 'error' ? 'text-error' :
              status === 'testing' ? 'text-secondary' :
              'text-outline-variant'
            }`}
          >
            {status === 'connected' ? 'Connected' :
             status === 'error' ? 'Failed' :
             status === 'testing' ? 'Testing...' :
             'Ready'}
          </span>
        </div>
      </div>
      {testError && (
        <p className="text-[10px] text-error mt-2 leading-snug break-words" title={testError}>
          ⚠ {testError}
        </p>
      )}
    </div>
  )
}

interface ApiConfigPlaceholderProps {
  onClick: () => void
}

export function ApiConfigPlaceholder({ onClick }: ApiConfigPlaceholderProps) {
  return (
    <div
      onClick={onClick}
      className="flex-shrink-0 w-72 p-5 bg-transparent rounded-xl border-2 border-dashed border-outline-variant flex flex-col items-center justify-center gap-2 hover:border-primary/50 cursor-pointer transition-all"
    >
      <span className="material-symbols-outlined text-3xl text-outline-variant">add_circle</span>
      <span className="text-sm font-bold text-outline-variant uppercase tracking-widest">
        Add Profile
      </span>
    </div>
  )
}

// ---------- Modal ----------

interface ApiConfigModalProps {
  profile: APIProfile | null
  onSave: (profile: APIProfile) => void
  onClose: () => void
}

export function ApiConfigModal({ profile, onSave, onClose }: ApiConfigModalProps) {
  const [name, setName] = useState(profile?.name || '')
  const [baseURL, setBaseURL] = useState(profile?.baseURL || 'https://api.openai.com/v1')
  const [apiKey, setApiKey] = useState(profile?.apiKey || '')
  const [model, setModel] = useState(profile?.model || '')
  const [maxTokens, setMaxTokens] = useState<number | undefined>(profile?.maxTokens)
  const [temperature, setTemperature] = useState<number | undefined>(profile?.temperature)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const finalMaxTokens = maxTokens && maxTokens > 0 ? maxTokens : undefined
    const finalTemperature = temperature != null && temperature >= 0 ? temperature : undefined
    onSave({
      id: profile?.id || crypto.randomUUID(),
      name,
      baseURL,
      apiKey,
      model,
      maxTokens: finalMaxTokens,
      temperature: finalTemperature,
    })
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100]" onClick={onClose}>
      <div className="bg-surface-container-low rounded-2xl p-8 w-full max-w-lg space-y-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <h3 className="font-headline text-xl font-bold">
          {profile ? '编辑 API 配置' : '添加 API 配置'}
        </h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">名称</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="例: Claude Sonnet"
              className="w-full bg-surface-container-high border-none rounded-lg text-on-surface py-2.5 px-4 focus:ring-2 focus:ring-primary"
              required
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">Base URL</label>
            <input
              type="text"
              value={baseURL}
              onChange={e => setBaseURL(e.target.value)}
              placeholder="https://api.openai.com/v1"
              className="w-full bg-surface-container-high border-none rounded-lg text-on-surface py-2.5 px-4 font-mono text-sm focus:ring-2 focus:ring-primary"
              required
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="sk-..."
              className="w-full bg-surface-container-high border-none rounded-lg text-on-surface py-2.5 px-4 font-mono text-sm focus:ring-2 focus:ring-primary"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">模型</label>
            <input
              type="text"
              value={model}
              onChange={e => setModel(e.target.value)}
              placeholder="gpt-4o / claude-sonnet-4-20250514"
              className="w-full bg-surface-container-high border-none rounded-lg text-on-surface py-2.5 px-4 font-mono text-sm focus:ring-2 focus:ring-primary"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">Max Tokens</label>
              <input
                type="number"
                value={maxTokens ?? ''}
                onChange={e => setMaxTokens(e.target.value ? Number(e.target.value) : undefined)}
                placeholder="默认 (不限制)"
                className="w-full bg-surface-container-high border-none rounded-lg text-on-surface py-2.5 px-4 focus:ring-2 focus:ring-primary"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">Temperature</label>
              <input
                type="number"
                value={temperature ?? ''}
                onChange={e => setTemperature(e.target.value ? Number(e.target.value) : undefined)}
                step="0.1"
                min="0"
                max="2"
                placeholder="默认"
                className="w-full bg-surface-container-high border-none rounded-lg text-on-surface py-2.5 px-4 focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2.5 rounded-lg text-on-surface-variant hover:bg-surface-container-high transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              className="px-6 py-2.5 rounded-lg bg-primary text-on-primary font-bold hover:bg-primary-container transition-colors"
            >
              保存
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
