import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/platform/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 text-sm font-medium transition duration-150 ease-out active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:pointer-events-none disabled:opacity-50 disabled:active:scale-100',
  {
    variants: {
      variant: {
        default: 'rounded-full bg-primary px-5 text-primary-foreground hover:bg-blue-400',
        destructive: 'rounded-lg bg-destructive px-4 text-white hover:bg-red-400',
        outline: 'rounded-full border border-primary/80 bg-transparent px-5 text-primary hover:bg-primary/10',
        secondary: 'rounded-lg bg-slate-800/70 px-4 text-slate-100 hover:bg-slate-700/80',
        ghost: 'rounded-lg text-foreground hover:bg-accent',
      },
      size: {
        default: 'h-10',
        sm: 'h-8 px-3 text-xs',
        lg: 'h-12 px-6 text-base',
        icon: 'h-10 w-10 rounded-full',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
  },
)
Button.displayName = 'Button'

export { buttonVariants }
