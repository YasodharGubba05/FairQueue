import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import type { Seat } from '@/lib/types';
import { formatPrice } from '@/lib/utils';
import { HoldCountdown } from './HoldCountdown';

/**
 * The bar that slides up once seats are chosen. It stays fixed to the bottom
 * so the countdown and the total never scroll out of sight.
 */
export function SelectionTray({
  seats,
  expiresAt,
  pending,
  onRemove,
  onContinue,
  onExpired,
}: {
  seats: Seat[];
  expiresAt: number | null;
  pending: boolean;
  onRemove: (seat: Seat) => void;
  onContinue: () => void;
  onExpired: () => void;
}) {
  const total = seats.reduce((acc, s) => acc + s.price, 0);

  return (
    <AnimatePresence>
      {seats.length > 0 ? (
        <motion.div
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', stiffness: 320, damping: 32 }}
          className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 backdrop-blur-xl"
        >
          <div className="mx-auto flex max-w-page flex-col gap-3 px-gutter py-3 lg:flex-row lg:items-center lg:px-gutter-lg">
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="flex items-center justify-between gap-3 lg:justify-start">
                <p className="text-sm font-medium">
                  {seats.length} {seats.length === 1 ? 'seat' : 'seats'} held for you
                </p>
                <HoldCountdown expiresAt={expiresAt} onExpired={onExpired} />
              </div>

              <ul className="scroll-slim flex gap-2 overflow-x-auto pb-1">
                {seats.map((seat) => (
                  <li key={seat.id}>
                    <button
                      type="button"
                      onClick={() => onRemove(seat)}
                      className="group flex items-center gap-2 whitespace-nowrap rounded-full border border-border bg-surface-raised py-1 pl-3 pr-2 text-xs transition-colors hover:border-danger/40"
                    >
                      <span>
                        {seat.section} {seat.row}
                        {seat.number}
                      </span>
                      <span className="text-muted">{formatPrice(seat.price)}</span>
                      <X
                        className="size-3.5 text-muted transition-colors group-hover:text-danger"
                        aria-hidden
                      />
                      <span className="sr-only">
                        Release seat {seat.section} row {seat.row} number {seat.number}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex items-center justify-between gap-4 lg:justify-end">
              <div className="text-right">
                <p className="text-xs uppercase tracking-wide text-muted">Total</p>
                <p className="font-display text-xl font-semibold tabular-nums">
                  {formatPrice(total)}
                </p>
              </div>
              <Button variant="gradient" size="lg" onClick={onContinue} disabled={pending}>
                {pending ? <Spinner /> : null}
                Checkout
                <ArrowRight aria-hidden />
              </Button>
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
