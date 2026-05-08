'use client'

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { log } from '@/lib/telemetry/logger'

type State = { hasError: boolean; error: Error | null }

/**
 * Last-resort UI boundary. Wraps the whole app so any unhandled render error
 * is surfaced as a static "Something went wrong" card with a Reload button.
 *
 * Notes:
 * - Does NOT catch errors in event handlers, async callbacks, or server
 *   components — those must use their own try/catch or error.tsx.
 * - Logs to `@/lib/telemetry/logger` so server-side collectors (if any) can
 *   capture client crashes in structured form. Intentionally does NOT send
 *   to third-party services; that can be added later.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    try {
      log.error('ui.error-boundary', {
        message: error.message,
        stack: error.stack,
        componentStack: info.componentStack,
      })
    } catch {
      // logger may not be available in some test contexts; swallow.
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-neutral-100">
          <div className="max-w-md rounded-2xl border border-red-500/40 bg-red-500/10 p-6 text-center shadow-2xl shadow-red-950/30">
            <div className="mb-2 text-lg font-semibold text-red-200">页面出错了</div>
            <div className="mb-4 break-words text-sm text-neutral-300">
              {this.state.error?.message ?? 'unknown error'}
            </div>
            <button
              type="button"
              className="rounded-md bg-red-500 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-red-400"
              onClick={() => window.location.reload()}
            >
              重新加载
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
