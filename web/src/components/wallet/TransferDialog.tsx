import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { FieldLabel, Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { api, ApiError } from '@/lib/api';
import type { WalletTicket } from '@/lib/types';
import { formatEventName } from '@/lib/utils';

/**
 * Handing a ticket to somebody else.
 *
 * Deliberately a little slow to confirm: the transfer cannot be undone, and
 * the recipient's address is spelled back before anything happens. The server
 * refuses a transfer that has already been made, so a double click costs
 * nothing — but a ticket sent to the wrong address is gone.
 */
export function TransferDialog({
  ticket,
  onClose,
  onTransferred,
}: {
  ticket: WalletTicket | null;
  onClose: () => void;
  onTransferred: () => void;
}) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ticket) {
      setEmail('');
      setError(null);
      // Focus moves into the dialog, so a keyboard user is not left behind it.
      const id = setTimeout(() => inputRef.current?.focus(), 80);
      return () => clearTimeout(id);
    }
  }, [ticket]);

  useEffect(() => {
    if (!ticket) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ticket, onClose]);

  async function submit() {
    if (!ticket) return;
    setPending(true);
    setError(null);
    try {
      await api.post(`/api/tickets/${ticket.id}/transfer`, { toEmail: email.trim() });
      onTransferred();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.status === 404
            ? 'No FairQueue account with that address, or that ticket is no longer yours.'
            : err.message
          : 'Could not reach the server',
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <AnimatePresence>
      {ticket ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.26 }}
          className="fixed inset-0 z-50 flex items-end justify-center bg-background/80 p-0 backdrop-blur-sm sm:items-center sm:p-gutter"
          onClick={(e) => e.target === e.currentTarget && onClose()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="transfer-title"
        >
          <motion.div
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            transition={{ duration: 0.32, ease: [0.22, 0.61, 0.36, 1] }}
            className="w-full max-w-reading rounded-t bg-surface p-7 shadow-lift-hover sm:rounded"
          >
            <Label>Transfer ticket</Label>
            <h2 id="transfer-title" className="mt-3 font-display text-xl font-light">
              {formatEventName(ticket.event.name)}
            </h2>
            <p className="mt-1.5 text-sm text-muted">
              {ticket.seat.section} · Row {ticket.seat.row} · Seat {ticket.seat.number}
            </p>

            <form
              className="mt-7 flex flex-col gap-6"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <div className="flex flex-col gap-3">
                <FieldLabel htmlFor="transfer-email">Recipient email</FieldLabel>
                <Input
                  ref={inputRef}
                  id="transfer-email"
                  type="email"
                  required
                  autoComplete="off"
                  placeholder="buyer0002@fairqueue.dev"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <p className="text-xs leading-relaxed text-faint">
                  They need a FairQueue account. The ticket leaves your wallet immediately and the
                  transfer cannot be undone.
                </p>
              </div>

              {error ? (
                <p role="alert" className="border-l border-danger pl-4 text-sm text-danger">
                  {error}
                </p>
              ) : null}

              <div className="flex items-center justify-end gap-3">
                <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={pending}>
                  Cancel
                </Button>
                <Button type="submit" variant="solid" size="md" disabled={pending || !email.trim()}>
                  {pending ? <Spinner /> : null}
                  {pending ? 'Transferring' : 'Transfer'}
                </Button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
