'use client'

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Lightweight "sheet" primitive layered on top of Radix Dialog.
 *
 * Sheets slide in from the right edge and are intended for secondary
 * panels on narrow viewports (e.g. the match spectator RightPanel on
 * mobile). Desktop layouts should keep using static `<aside>` and only
 * swap to Sheet below the `lg` breakpoint.
 */
export const Sheet = DialogPrimitive.Root
export const SheetTrigger = DialogPrimitive.Trigger
export const SheetClose = DialogPrimitive.Close
export const SheetPortal = DialogPrimitive.Portal

export const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn('fixed inset-0 z-50 bg-black/70 backdrop-blur-sm', className)}
    {...props}
  />
))
SheetOverlay.displayName = 'SheetOverlay'

export const SheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    side?: 'right' | 'left' | 'bottom'
  }
>(({ className, children, side = 'right', ...props }, ref) => {
  const sideClass =
    side === 'right'
      ? 'inset-y-0 right-0 h-full w-80 max-w-[90vw] border-l data-[state=open]:slide-in-from-right'
      : side === 'left'
        ? 'inset-y-0 left-0 h-full w-80 max-w-[90vw] border-r data-[state=open]:slide-in-from-left'
        : 'inset-x-0 bottom-0 h-[75vh] border-t'

  return (
    <SheetPortal>
      <SheetOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          'fixed z-50 border-border bg-slate-950/95 p-4 shadow-2xl shadow-cyan-950/30 backdrop-blur',
          sideClass,
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="absolute right-3 top-3 rounded-sm opacity-70 transition-opacity hover:opacity-100">
          <X className="h-4 w-4" />
          <span className="sr-only">关闭</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </SheetPortal>
  )
})
SheetContent.displayName = 'SheetContent'

export const SheetHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('mb-3 flex flex-col space-y-1 text-left', className)} {...props} />
)

export const SheetTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('text-lg font-semibold leading-none', className)}
    {...props}
  />
))
SheetTitle.displayName = 'SheetTitle'
