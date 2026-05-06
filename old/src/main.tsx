import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/index.css'
import App from './App'
import { downloadLogs, exportLogs, getLogCount, clearLogs } from './debug/state-logger'
import { registerAllGames } from './games'

// crypto.randomUUID polyfill — HTTP 环境下不可用
if (typeof crypto !== 'undefined' && !crypto.randomUUID) {
  crypto.randomUUID = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(16))
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}` as ReturnType<typeof crypto.randomUUID>
  }
}

// 把日志工具挂到 window，方便控制台调用
Object.assign(window, {
  gameDebug: { downloadLogs, exportLogs, getLogCount, clearLogs },
  // Legacy alias
  pokerDebug: { downloadLogs, exportLogs, getLogCount, clearLogs },
})

// 注册所有游戏插件
registerAllGames()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
