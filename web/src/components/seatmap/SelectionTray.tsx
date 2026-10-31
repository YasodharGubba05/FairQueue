import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import type { Seat } from '@/lib/types';
import { formatPrice } from '@/lib/utils';
import { HoldCountdown } from './HoldCountdown';

/**
 * The bar that rises once seats are chosen. Fixed to the bottom on a hairline,
 * so the countdown and the total never scroll out of sight — and no card, so it
 * reads as the page continuing rather than a panel landing on top of it.
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
          transition={{ duration: 0.42, ease: [0.22, 0.61, 0.36, 1] }}
          className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 backdrop-blur-xl"
        >
          <div className="mx-auto flex max-w-page flex-col gap-4 px-gutter py-5 lg:flex-row lg:items-center lg:gap-10 lg:px-gutter-lg">
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <div className="flex items-center justify-between gap-4">
                <Label tone="foreground">
                  {seats.length} {seats.length === 1 ? 'seat' : 'seats'} held
                </Label>
                <HoldCountdown expiresAt={expiresAt} onExpired={onExpired} />
              </div>

              <ul className="scroll-slim flex gap-5 overflow-x-auto">
                {seats.map((seat) => (
                  <li key={seat.id}>
                    <button
                      type="button"
                      onClick={() => onRemove(seat)}
                      className="group flex items-center gap-2.5 whitespace-nowrap text-sm text-muted-foreground transition-colors duration-[var(--dur-fast)] hover:text-foreground"
                    >
                      <span className="text-foreground">
                        {seat.section} {seat.row}
                        {seat.number}
                      </span>
                      <span data-numeral>{formatPrice(seat.price)}</span>
                      <X className="size-3.5 opacity-40 transition-opacity group-hover:opacity-100" aria-hidden />
                      <span className="sr-only">
                        Release seat {seat.section} row {seat.row} number {seat.number}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex items-center justify-between gap-6 lg:justify-end">
              <div className="flex flex-col gap-1.5">
                <Label>Total</Label>
                <span data-numeral className="font-display text-2xl font-light">
                  {formatPrice(total)}
                </span>
              </div>
              <Button variant="solid" size="lg" onClick={onContinue} disabled={pending}>
                {pending ? <Spinner /> : null}
                Checkout
              </Button>
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
