'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'

/**
 * Global keyboard shortcuts + `?` help panel.
 *
 * Bindings:
 *   `?`         toggle this panel
 *   `g h`       go Lobby
 *   `g a`       go Agents
 *   `g p`       go Profiles
 *   `n`         new match (`/matches/new`)
 *   `Space`     replay player play/pause (handled inside ReplayControls)
 *
 * Shortcuts are ignored while an input / textarea / contentEditable is
 * focused so they never steal keystrokes from forms.
 */
const SHORTCUTS = [
  { keys: '?', desc: '显示这个面板' },
  { keys: 'g h', desc: '去 Lobby' },
  { keys: 'g a', desc: '去 Agents' },
  { keys: 'g p', desc: '去 Profiles' },
  { keys: 'n', desc: '新建对局' },
  { keys: 'Space', desc: '(回放页)暂停 / 播放' },
]

export function Shortcuts() {
  const [open, setOpen] = useState(false)
  const router = useRouter()

  useEffect(() => {
    let buf: 'g' | '' = ''
    let timer: ReturnType<typeof setTimeout> | null = null

    const clearBuf = () => {
      buf = ''
      if (timer) clearTimeout(timer)
      timer = null
    }

    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return
      if (e.metaKey || e.ctrlKey || e.altKey) return

      if (e.key === '?') {
        e.preventDefault()
        setOpen((v) => !v)
        return
      }

      // Two-key prefix "g <x>"
      if (buf === 'g') {
        if (e.key === 'h') router.push('/')
        else if (e.key === 'a') router.push('/agents')
        else if (e.key === 'p') router.push('/profiles')
        clearBuf()
        return
      }

      if (e.key === 'g') {
        buf = 'g'
        timer = setTimeout(clearBuf, 800)
        return
      }

      if (e.key === 'n') {
        router.push('/matches/new')
      }
    }

    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (timer) clearTimeout(timer)
    }
  }, [router])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>键盘快捷键</DialogTitle>
        </DialogHeader>
        <ul className="space-y-2 pt-1">
          {SHORTCUTS.map((s) => (
            <li key={s.keys} className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{s.desc}</span>
              <kbd className="rounded border border-border bg-slate-900 px-2 py-0.5 font-mono text-xs text-cyan-100">
                {s.keys}
              </kbd>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  )
}
