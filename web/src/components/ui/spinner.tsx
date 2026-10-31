import { cn } from '@/lib/utils';

/**
 * A thin ring, drawn rather than borrowed from the icon set, so its weight
 * matches the hairlines everywhere else.
 */
export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn('size-4 animate-spin', className)} viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1" opacity="0.25" />
      <path d="M14.5 8A6.5 6.5 0 0 0 8 1.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}
