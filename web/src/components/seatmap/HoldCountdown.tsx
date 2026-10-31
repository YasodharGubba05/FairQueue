import { useEffect, useState } from 'react';
import { Timer } from 'lucide-react';
import { cn, formatCountdown } from '@/lib/utils';

/**
 * How long the seats stay yours. The buyer needs to see this the whole time —
 * a hold quietly running out while they fill in a card is the worst version of
 * this screen.
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

  // Under a minute left is worth shouting about.
  const urgent = remaining < 60_000;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-sm tabular-nums',
        urgent ? 'text-danger' : 'text-muted',
        className,
      )}
      role="timer"
      aria-live={urgent ? 'assertive' : 'off'}
    >
      <Timer className="size-4" aria-hidden />
      {formatCountdown(remaining)}
      <span className="sr-only">left to complete your purchase</span>
    </span>
  );
}
