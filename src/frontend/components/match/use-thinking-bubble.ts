'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * 思考气泡可见性 hook：输入当前思考文本（来自 thinking-store.current[agentId]?.text，
 * 随 SSE delta 实时增长），输出 { text, visible }。
 *
 * 行为镜像扑克 PlayerSeat 的内联实现：有文本即显示，THINKING_BUBBLE_VISIBLE_MS 内
 * 若无新文本则淡出。当前正在思考的判定由调用方据 `visible`/`text` 决定是否额外
 * 渲染"思考中"药丸。
 */
const THINKING_BUBBLE_VISIBLE_MS = 4500

export function useThinkingBubble(thinking: string | undefined) {
  const [text, setText] = useState('')
  const [visible, setVisible] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const next = thinking?.trim() ?? ''
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (!next) {
      setVisible(false)
      setText('')
      return
    }

    const updatedAt = Date.now()
    setText(next)
    setVisible(true)
    timerRef.current = setTimeout(() => {
      setVisible((current) => current && next.trim().length > 0 && Date.now() - updatedAt < THINKING_BUBBLE_VISIBLE_MS)
      timerRef.current = null
    }, THINKING_BUBBLE_VISIBLE_MS)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [thinking])

  return { text, visible }
}
