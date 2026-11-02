import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Label, StatusLabel } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { formatDate, formatEventName, formatTime } from '@/lib/utils';

type Verification = {
  valid: boolean;
  reason: string | null;
  ticket?: {
    id: string;
    seat: { section: string; row: string; number: number };
    event: { name: string; venue: string; startsAt: string };
    transferCount: number;
    issuedAt: string;
  };
  simulated: boolean;
  admitsToRealEvent: boolean;
  note: string;
};

/**
 * Where a scanned FairQueue code lands.
 *
 * Public, because a door scanner has no account. The single most important
 * thing on this page is not whether the code resolved — it is the line saying
 * this admits nobody to anything, which is why that sits above the result
 * rather than in small print under it.
 */
export default function VerifyTicket() {
  const { ticketId = '' } = useParams();
  const [result, setResult] = useState<Verification | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<Verification>(`/api/verify/${ticketId}`)
      .then(setResult)
      .catch((err) => {
        // A 404 is a result, not an error: the code simply did not resolve.
        setResult(
          err?.status === 404
            ? {
                valid: false,
                reason: 'No such ticket',
                simulated: true,
                admitsToRealEvent: false,
                note: 'FairQueue is a demonstration. This code is not a ticket to anything.',
              }
            : null,
        );
      })
      .finally(() => setLoading(false));
  }, [ticketId]);

  return (
    <div className="mx-auto flex min-h-[70svh] max-w-reading flex-col justify-center px-gutter py-16">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.52, ease: [0.22, 0.61, 0.36, 1] }}
        className="flex flex-col gap-8"
      >
        {/* Above the result on purpose. */}
        <p className="border-l border-warning pl-4 text-sm leading-relaxed text-warning">
          This is a FairQueue demonstration ticket. It admits nobody to any real event, and no
          payment was taken for it.
        </p>

        {loading ? (
          <>
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-14 w-full" />
          </>
        ) : !result ? (
          <div className="flex flex-col gap-4">
            <Label tone="danger">Could not check</Label>
            <h1 className="font-display text-display-sm">The server did not answer</h1>
          </div>
        ) : (
          <div className="flex flex-col gap-8">
            <div className="flex flex-col gap-4">
              <StatusLabel tone={result.valid ? 'live' : 'danger'}>
                {result.valid ? 'Code recognised' : 'Not valid'}
              </StatusLabel>
              <h1 className="font-display text-display-sm">
                {result.valid ? 'This code exists in the demo' : (result.reason ?? 'Unknown code')}
              </h1>
            </div>

            {result.ticket ? (
              <dl className="flex flex-col text-sm">
                <Row label="Event" value={formatEventName(result.ticket.event.name)} />
                <Row label="Venue" value={result.ticket.event.venue} />
                <Row
                  label="Starts"
                  value={`${formatDate(result.ticket.event.startsAt)} · ${formatTime(result.ticket.event.startsAt)}`}
                />
                <Row
                  label="Seat"
                  value={`${result.ticket.seat.section} · Row ${result.ticket.seat.row} · Seat ${result.ticket.seat.number}`}
                />
                <Row label="Transfers" value={String(result.ticket.transferCount)} />
              </dl>
            ) : null}

            <p className="text-xs leading-relaxed text-faint">
              A recognised code means this ticket exists in FairQueue and its event has not
              finished. Nothing more. The holder&rsquo;s identity is deliberately not shown here.
            </p>
          </div>
        )}

        <Button asChild variant="subtle" size="sm" className="self-start">
          <Link to="/">FairQueue home</Link>
        </Button>
      </motion.div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b py-3 last:border-b-0">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}
