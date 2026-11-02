import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { QRCodeSVG } from 'qrcode.react';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Label, StatusLabel } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { TiltCard } from '@/components/ui/tilt-card';
import { TransferDialog } from '@/components/wallet/TransferDialog';
import { api } from '@/lib/api';
import type { TicketDetail as Detail } from '@/lib/types';
import { formatDate, formatEventName, formatPrice, formatTime } from '@/lib/utils';

/** The QR encodes the verification URL, so a scanner lands somewhere useful. */
function verifyUrl(ticketId: string) {
  return `${window.location.origin}/verify/${ticketId}`;
}

export default function TicketDetail() {
  const { ticketId = '' } = useParams();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [missing, setMissing] = useState(false);
  const [transferring, setTransferring] = useState(false);

  function load() {
    api
      .get<Detail>(`/api/tickets/${ticketId}`)
      .then(setDetail)
      .catch(() => setMissing(true));
  }

  useEffect(load, [ticketId]);

  if (missing) {
    return (
      <div className="mx-auto max-w-page px-gutter lg:px-gutter-lg">
        <EmptyState
          tone="danger"
          title="Ticket not found"
          description="That ticket does not exist, or it is not yours."
          action={
            <Button asChild variant="subtle" size="sm">
              <Link to="/wallet">Back to your wallet</Link>
            </Button>
          }
        />
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="mx-auto flex max-w-reading flex-col gap-8 px-gutter py-16">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const { ticket, timeline } = detail;

  return (
    <div className="mx-auto max-w-reading px-gutter pb-24 pt-8">
      <Link
        to="/wallet"
        className="inline-flex items-center gap-2 rounded-sm text-sm text-muted transition-colors duration-[var(--dur-fast)] hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden /> Wallet
      </Link>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.52, ease: [0.22, 0.61, 0.36, 1] }}
        className="mt-8 flex flex-col gap-10"
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            {ticket.event.verified ? (
              <StatusLabel tone="live">Verified real event</StatusLabel>
            ) : (
              <StatusLabel tone="muted">Simulated event</StatusLabel>
            )}
            {ticket.event.sourceUrl ? (
              <a
                href={ticket.event.sourceUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1.5 rounded-sm text-xs text-muted hover:text-foreground"
              >
                {ticket.event.sourceName ?? ticket.event.sourceLabel}
                <ExternalLink className="size-3" aria-hidden />
              </a>
            ) : null}
          </div>

          <h1 className="font-display text-display-sm">{formatEventName(ticket.event.name)}</h1>
          <p className="text-sm text-muted-foreground">
            {ticket.event.venue}
            {ticket.event.city ? ` · ${ticket.event.city}` : ''} ·{' '}
            {formatDate(ticket.event.startsAt)} · {formatTime(ticket.event.startsAt)}
          </p>
        </div>

        <TiltCard className="rounded">
          <div className="flex flex-col gap-6 p-7">
            <dl className="flex flex-col gap-3 text-sm">
              <div className="flex justify-between gap-4 border-b pb-3">
                <dt className="text-muted">Seat</dt>
                <dd>
                  {ticket.seat.section} · Row {ticket.seat.row} · Seat {ticket.seat.number}
                </dd>
              </div>
              <div className="flex justify-between gap-4 border-b pb-3">
                <dt className="text-muted">Face value</dt>
                <dd data-numeral>{formatPrice(ticket.seat.price)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Transfers</dt>
                <dd data-numeral>{ticket.transferCount}</dd>
              </div>
            </dl>

            <div className="flex items-end justify-between gap-6 border-t pt-6">
              <div className="flex flex-col gap-2">
                <Label>Ticket</Label>
                <span className="break-all font-mono text-xs text-muted-foreground">
                  {ticket.id}
                </span>
              </div>
              <div className="shrink-0 bg-white p-3">
                <QRCodeSVG value={verifyUrl(ticket.id)} size={92} level="M" />
              </div>
            </div>
          </div>
        </TiltCard>

        <section className="flex flex-col gap-5">
          <Label>History</Label>
          <ol className="flex flex-col">
            {timeline.map((entry, i) => (
              <li key={i} className="flex gap-5 border-b py-4 last:border-b-0">
                <span className="w-32 shrink-0 text-xs text-faint" data-numeral>
                  {formatDate(entry.at)}
                </span>
                <span className="text-sm">
                  {entry.kind === 'purchased' ? (
                    'Bought'
                  ) : (
                    <>
                      Transferred
                      {entry.actor ? (
                        <span className="text-muted">
                          {' '}
                          from {entry.actor.from} to {entry.actor.to}
                        </span>
                      ) : null}
                    </>
                  )}
                </span>
              </li>
            ))}
          </ol>
        </section>

        <div className="flex flex-col gap-5 border-t pt-8">
          <p className="text-xs leading-relaxed text-faint">
            This ticket is simulated. Scanning the code confirms it exists in this demonstration
            and nothing more — it admits nobody to any real event, and no payment was taken.
          </p>
          {ticket.transferable ? (
            <Button variant="outline" size="md" className="self-start" onClick={() => setTransferring(true)}>
              Transfer this ticket
            </Button>
          ) : (
            <p className="text-xs text-faint">That event is over, so this can no longer be transferred.</p>
          )}
        </div>
      </motion.div>

      <TransferDialog
        ticket={transferring ? ticket : null}
        onClose={() => setTransferring(false)}
        onTransferred={() => {
          setTransferring(false);
          load();
        }}
      />
    </div>
  );
}
