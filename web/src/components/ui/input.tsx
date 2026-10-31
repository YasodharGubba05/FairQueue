import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Fields are a line, not a box. The input sits on the page with a hairline
 * underneath it, and the line brightens when focused — the same idea as the
 * rest of the system, where structure comes from rules rather than borders.
 */
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'h-11 w-full rounded-none border-0 border-b bg-transparent px-0 font-sans text-base text-foreground',
        'placeholder:text-faint',
        'transition-colors duration-[var(--dur-fast)] focus-visible:border-foreground focus-visible:ring-0 focus-visible:ring-offset-0',
        'disabled:cursor-not-allowed disabled:opacity-40',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export const FieldLabel = React.forwardRef<
  HTMLLabelElement,
  React.LabelHTMLAttributes<HTMLLabelElement>
>(({ className, ...props }, ref) => (
  <label ref={ref} className={cn('label', className)} {...props} />
));
FieldLabel.displayName = 'FieldLabel';

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      'h-11 w-full rounded-none border-0 border-b bg-transparent px-0 font-sans text-base text-foreground',
      'transition-colors duration-[var(--dur-fast)] focus-visible:border-foreground focus-visible:ring-0 focus-visible:ring-offset-0',
      'disabled:cursor-not-allowed disabled:opacity-40',
      className,
    )}
    {...props}
  />
));
Select.displayName = 'Select';
