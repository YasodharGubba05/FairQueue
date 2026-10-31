import { cn } from '@/lib/utils';

/**
 * A loading placeholder. Just a faint block that breathes — no shimmer sweep,
 * because a gradient animation is exactly the kind of ornament this design
 * does without.
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse bg-[hsl(var(--foreground)/0.06)]', className)}
      {...props}
    />
  );
}
