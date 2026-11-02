import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowUpRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Label, StatusLabel } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { TiltCard } from '@/components/ui/tilt-card';
import { TransferDialog } from '@/components/wallet/TransferDialog';
import { api } from '@/lib/api';
import type { WalletResponse, WalletTicket } from '@/lib/types';
import { formatDate, formatEventName, formatPrice, formatTime } from '@/lib/utils';

/**
 * Everything this person holds.
 *
 * Split into what is still ahead and what has been, because "have I still got
 * something to go to" is the question a wallet exists to answer. The split is
 * computed on the server so the client is not deciding what counts as past.
 */
export default function Wallet() {
  const [data, setData] = useState<WalletResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [transferring, setTransferring] = useState<WalletTicket | null>(null);

  const load = useCallback(() => {
    api
      .get<WalletResponse>('/api/wallet')
      .then((res) => {
        setData(res);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, []);

  useEffect(load, [load]);

  const { upcoming, past } = useMemo(() => {
    const now = Date.now();
    const tickets = data?.tickets ?? [];
    return {
      upcoming: tickets.filter(
        (t) => new Date(t.event.endsAt).getTime() > now && t.event.status !== 'CANCELLED',
      ),
      past: tickets.filter(
        (t) => new Date(t.event.endsAt).getTime() <= now || t.event.status === 'CANCELLED',
      ),
    };
  }, [data]);

  if (failed) {
    return (
      <div className="mx-auto max-w-page px-gutter lg:px-gutter-lg">
        <EmptyState
          tone="danger"
          title="Could not load your wallet"
          description="The api is not answering. Reload and try again."
          action={
            <Button variant="subtle" size="sm" onClick={load}>
              Try again
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-page px-gutter pb-24 pt-8 lg:px-gutter-lg">
      <div className="border-b pb-8">
        <Label>Wallet</Label>
        <h1 className="mt-3 font-display text-display-sm sm:text-display-md">Your tickets</h1>
        <p className="mt-4 max-w-reading text-sm leading-relaxed text-muted-foreground">
          Every ticket here is simulated. FairQueue is a demonstration of fair queueing and seat
          locking, and none of these admit anybody to anything.
        </p>
      </div>

      {data === null ? (
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-56" />
          ))}
        </div>
      ) : data.tickets.length === 0 ? (
        <EmptyState
          title="No tickets yet"
          description="Join a queue, pick a seat, and whatever you buy turns up here."
          action={
            <Button asChild variant="solid" size="sm">
              <Link to="/">Find an event</Link>
            </Button>
          }
        />
      ) : (
        <>
          {upcoming.length > 0 ? (
            <section className="mt-12">
              <Label className="block">Coming up</Label>
              <ul className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {upcoming.map((ticket, i) => (
                  <TicketCard
                    key={ticket.id}
                    ticket={ticket}
                    index={i}
                    onTransfer={() => setTransferring(ticket)}
                  />
                ))}
              </ul>
            </section>
          ) : null}

          {past.length > 0 ? (
            <section className="mt-16">
              <Label className="block">Been and gone</Label>
              <ul className="mt-6 grid gap-5 opacity-50 sm:grid-cols-2 lg:grid-cols-3">
                {past.map((ticket, i) => (
                  <TicketCard key={ticket.id} ticket={ticket} index={i} />
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}

      <TransferDialog
        ticket={transferring}
        onClose={() => setTransferring(null)}
        onTransferred={() => {
          setTransferring(null);
          load();
        }}
      />
    </div>
  );
}

function TicketCard({
  ticket,
  index,
  onTransfer,
}: {
  ticket: WalletTicket;
  index: number;
  onTransfer?: () => void;
}) {
  return (
    <motion.li
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.42, delay: Math.min(index, 8) * 0.04, ease: [0.22, 0.61, 0.36, 1] }}
    >
      <TiltCard className="h-full" disabled={!onTransfer}>
        <div className="flex h-full flex-col gap-5 p-6">
          <div className="flex items-start justify-between gap-3">
            {ticket.event.verified ? (
              <StatusLabel tone="live" className="whitespace-nowrap">
                Verified real event
              </StatusLabel>
            ) : (
              <StatusLabel tone="muted" className="whitespace-nowrap">
                Simulated event
              </StatusLabel>
            )}
            {ticket.receivedByTransfer ? <Label>Received</Label> : null}
          </div>

          <div>
            <h2 className="font-display text-lg font-light leading-snug tracking-tight">
              <Link to={`/tickets/${ticket.id}`} className="rounded-sm hover:opacity-70">
                {formatEventName(ticket.event.name)}
              </Link>
            </h2>
            <p className="mt-2 text-sm text-muted">
              {ticket.event.venue}
              {ticket.event.city ? ` · ${ticket.event.city}` : ''}
            </p>
          </div>

          <dl className="mt-auto flex flex-col gap-3 border-t pt-4 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Seat</dt>
              <dd>
                {ticket.seat.section} · {ticket.seat.row}
                {ticket.seat.number}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">When</dt>
              <dd data-numeral>
                {formatDate(ticket.event.startsAt)} · {formatTime(ticket.event.startsAt)}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Paid</dt>
              <dd data-numeral>{formatPrice(ticket.seat.price)}</dd>
            </div>
          </dl>

          <div className="flex items-center justify-between gap-3">
            <Button asChild variant="ghost" size="sm">
              <Link to={`/tickets/${ticket.id}`}>
                View <ArrowUpRight aria-hidden />
              </Link>
            </Button>
            {onTransfer && ticket.transferable ? (
              <Button variant="outline" size="sm" onClick={onTransfer}>
                Transfer
              </Button>
            ) : null}
          </div>
        </div>
      </TiltCard>
    </motion.li>
  );
}
