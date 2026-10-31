import { cn } from '@/lib/utils';

/** Three bars that step down: a line being served. */
export function Logo({ className, withWordmark = true }: { className?: string; withWordmark?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <svg viewBox="0 0 32 32" className="size-8 shrink-0" aria-hidden>
        <defs>
          <linearGradient id="fq-logo" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="hsl(var(--accent))" />
            <stop offset="1" stopColor="hsl(var(--highlight))" />
          </linearGradient>
        </defs>
        <rect width="32" height="32" rx="8" fill="url(#fq-logo)" />
        <g fill="hsl(var(--accent-foreground))">
          <rect x="8" y="9" width="4" height="14" rx="2" />
          <rect x="14" y="13" width="4" height="10" rx="2" opacity="0.75" />
          <rect x="20" y="17" width="4" height="6" rx="2" opacity="0.5" />
        </g>
      </svg>
      {withWordmark ? (
        <span className="font-display text-lg font-semibold tracking-tight">FairQueue</span>
      ) : null}
      <span className="sr-only">FairQueue home</span>
    </span>
  );
}
