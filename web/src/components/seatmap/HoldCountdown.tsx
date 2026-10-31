import { useEffect, useState } from 'react';
import { cn, formatCountdown } from '@/lib/utils';

/**
 * How long the seats stay yours. A hold quietly running out while someone is
 * filling in a card is the worst thing this product could do, so the number is
 * never hidden — and it turns red in the last minute rather than shouting the
 * whole time.
 */
export function HoldCountdown({
  expiresAt,
  onExpired,
  className,
}: {
  expiresAt: number | null;
  onExpired?: () => void;
  className?: string;
}) {
  const [remaining, setRemaining] = useState(() =>
    expiresAt === null ? 0 : expiresAt - Date.now(),
  );

  useEffect(() => {
    if (expiresAt === null) return;
    setRemaining(expiresAt - Date.now());

    const id = setInterval(() => {
      const left = expiresAt - Date.now();
      setRemaining(left);
      if (left <= 0) {
        clearInterval(id);
        onExpired?.();
      }
    }, 500);

    return () => clearInterval(id);
  }, [expiresAt, onExpired]);

  if (expiresAt === null) return null;

  const urgent = remaining < 60_000;

  return (
    <span
      className={cn('inline-flex items-baseline gap-2.5', className)}
      role="timer"
      aria-live={urgent ? 'assertive' : 'off'}
    >
      <span className="label">Held for</span>
      <span
        data-numeral
        className={cn(
          'font-display text-base font-light transition-colors duration-[var(--dur-fast)]',
          urgent ? 'text-danger' : 'text-foreground',
        )}
      >
        {formatCountdown(remaining)}
      </span>
      <span className="sr-only">left to complete your purchase</span>
    </span>
  );
}
