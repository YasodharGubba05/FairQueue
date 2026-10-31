import { cn } from '@/lib/utils';

/**
 * The 11px tracked uppercase label that names every large number and every
 * section. This replaces the badge: a pill with a coloured background is
 * decoration, and a word is information.
 */
export function Label({
  children,
  className,
  tone = 'muted',
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: 'muted' | 'foreground' | 'live' | 'warning' | 'danger' }) {
  return (
    <span
      className={cn(
        'label',
        tone === 'foreground' && 'text-foreground',
        tone === 'live' && 'text-success',
        tone === 'warning' && 'text-warning',
        tone === 'danger' && 'text-danger',
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}

/**
 * A label with a small dot in front of it, for live status. The dot is the
 * only ornament in the product, and it earns its place by pulsing only while
 * something is genuinely live.
 */
export function StatusLabel({
  children,
  tone = 'live',
  pulse = false,
  className,
}: {
  children: React.ReactNode;
  tone?: 'live' | 'warning' | 'danger' | 'muted';
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <span
        aria-hidden
        className={cn(
          'size-1.5 rounded-pill',
          tone === 'live' && 'bg-success',
          tone === 'warning' && 'bg-warning',
          tone === 'danger' && 'bg-danger',
          tone === 'muted' && 'bg-muted',
          pulse && 'animate-pulse',
        )}
      />
      <Label tone={tone === 'muted' ? 'muted' : tone}>{children}</Label>
    </span>
  );
}
