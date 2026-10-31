import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * Buttons are pills with small, widely tracked uppercase text. There are only
 * two that matter — a solid one and a translucent one — because a screen with
 * three equally loud buttons has not decided what it wants you to do.
 */
const buttonVariants = cva(
  // Buttons lift a little and settle when pressed. Small enough to read as
  // weight rather than as an animation.
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-pill font-sans uppercase tracking-[0.1em] [&_svg]:size-4 [&_svg]:shrink-0 disabled:pointer-events-none disabled:opacity-40 ' +
    'transition-[background-color,box-shadow,transform,opacity] duration-[var(--dur-fast)] ease-ease ' +
    'hover:-translate-y-px active:translate-y-0 active:scale-[0.985] disabled:translate-y-0',
  {
    variants: {
      variant: {
        // The one action this screen exists for.
        solid:
          'bg-[hsl(var(--fill-strong))] text-[hsl(var(--fill-strong-foreground))] shadow-lift hover:opacity-95 hover:shadow-lift-hover',
        // Everything else worth clicking.
        subtle:
          'bg-[hsl(var(--foreground)/var(--fill-subtle-alpha))] text-foreground hover:bg-[hsl(var(--foreground)/var(--fill-subtle-hover-alpha))] hover:shadow-lift',
        // A hairline outline, for destructive or secondary paths.
        outline: 'border text-foreground hover:border-strong hover:bg-[hsl(var(--foreground)/0.04)]',
        // No chrome at all: icon buttons and inline actions.
        ghost:
          'text-muted-foreground hover:text-foreground hover:bg-[hsl(var(--foreground)/var(--fill-subtle-alpha))]',
        danger: 'bg-danger text-white hover:opacity-90',
      },
      size: {
        sm: 'h-8 px-4 text-[0.6875rem]',
        md: 'h-11 px-7 text-[0.6875rem]',
        lg: 'h-13 px-10 text-xs',
        // Icon buttons keep their own shape and drop the tracking.
        icon: 'size-10 rounded-pill px-0 tracking-normal',
      },
    },
    defaultVariants: { variant: 'solid', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
  },
);
Button.displayName = 'Button';

export { buttonVariants };
