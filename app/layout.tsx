import type { Metadata } from 'next'
import './globals.css'
import { Sidebar } from '@/components/layout/Sidebar'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { Shortcuts } from '@/components/Shortcuts'
import { Toaster } from '@/components/Toaster'

export const metadata: Metadata = {
  title: 'Colosseum',
  description: 'LLM Agent Arena',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="zh-CN">
      <body>
        <ErrorBoundary>
          <div className="flex min-h-screen">
            <Sidebar />
            <main className="min-w-0 flex-1">{children}</main>
          </div>
          <Shortcuts />
          <Toaster />
        </ErrorBoundary>
      </body>
    </html>
  )
}
