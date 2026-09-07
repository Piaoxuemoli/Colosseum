'use client'

import { Component, type ReactNode } from 'react'

/**
 * Surface 渲染错误边界：当粘贴的 surface 在运行期触发渲染异常时，
 * 显示降级提示而不是整页崩溃。resetKey 变化时清空错误状态（重新尝试渲染）。
 */
interface Props {
  children: ReactNode
  resetKey: string
}

interface State {
  error: Error | null
}

export class SurfaceErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null })
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="rounded-lg border border-red-500/40 bg-red-950/20 p-4 text-sm text-red-200">
          <div className="font-semibold">渲染失败</div>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-xs text-red-300/80">
            {this.state.error.message}
          </pre>
          <div className="mt-2 text-xs text-red-300/60">编辑左侧 JSON 后将自动重试。</div>
        </div>
      )
    }
    return this.props.children
  }
}
