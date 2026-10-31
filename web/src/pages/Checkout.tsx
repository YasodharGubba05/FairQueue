import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { FieldLabel, Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { HoldCountdown } from '@/components/seatmap/HoldCountdown';
import { api, ApiError } from '@/lib/api';
import type { EventSummary, HoldState, Seat } from '@/lib/types';
import { formatEventName, formatPrice } from '@/lib/utils';

/** What went wrong, and what the buyer can actually do about it. */
type Failure = { title: string; description: string; action: 'back-to-seats' | 'retry' };

function failureFor(err: ApiError): Failure {
  if (err.status === 402) {
    return {
      title: 'Payment declined',
      description: 'Nothing has been charged and your seats are still held. Try another card.',
      action: 'retry',
    };
  }
  if (err.status === 403) {
    return {
      title: 'You need to go through the queue',
      description: 'Your admission pass has run out. Join the line again to pick seats.',
      action: 'back-to-seats',
    };
  }
  return {
    title: err.message.includes('ran out') ? 'Your hold ran out' : 'Those seats are gone',
    description: `${err.message}. Head back to the map and pick again.`,
    action: 'back-to-seats',
  };
}

export default function Checkout() {
  const { eventId = '' } = useParams();
  const navigate = useNavigate();

  const [event, setEvent] = useState<EventSummary | null>(null);
  const [seats, setSeats] = useState<Seat[] | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [pending, setPending] = useState(false);

  const [cardNumber, setCardNumber] = useState('4242 4242 4242 4242');
  const [name, setName] = useState('Test Buyer');

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;

    async function load() {
      try {
        const [eventRes, holds, seatRes] = await Promise.all([
          api.get<{ event: EventSummary }>(`/api/events/${eventId}`),
          api.get<HoldState>(`/api/events/${eventId}/holds`),
          api.get<{ seats: Seat[] }>(`/api/events/${eventId}/seats`),
        ]);
        if (cancelled) return;
        setEvent(eventRes.event);
        setExpiresAt(holds.expiresAt);
        const held = new Set(holds.seatIds);
        setSeats(seatRes.seats.filter((s) => held.has(s.id)));
      } catch {
        if (!cancelled) {
          setFailure({
            title: 'Could not load your seats',
            description: 'The server is not answering. Go back and try again.',
            action: 'back-to-seats',
          });
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  const onExpired = useCallback(() => {
    setSeats([]);
    setExpiresAt(null);
    setFailure({
      title: 'Your hold ran out',
      description: 'Those seats went back on sale. Pick again and you can still get in.',
      action: 'back-to-seats',
    });
  }, []);

  async function pay() {
    if (!seats || seats.length === 0) return;
    setPending(true);
    setFailure(null);
    try {
      const res = await api.post<{ orderId: string }>(`/api/events/${eventId}/checkout`, {
        seatIds: seats.map((s) => s.id),
        payment: { cardNumber, name },
      });
      navigate(`/orders/${res.orderId}`, { replace: true });
    } catch (err) {
      setFailure(
        err instanceof ApiError
          ? failureFor(err)
          : {
              title: 'Could not reach the server',
              description: 'Your seats are still held. Try again in a moment.',
              action: 'retry',
            },
      );
    } finally {
      setPending(false);
    }
  }

  const total = (seats ?? []).reduce((acc, s) => acc + s.price, 0);

  if (seats !== null && seats.length === 0 && failure?.action !== 'retry') {
    return (
      <div className="mx-auto max-w-page px-gutter lg:px-gutter-lg">
        <EmptyState
          tone={failure ? 'danger' : 'neutral'}
          title={failure?.title ?? 'No seats held'}
          description={
            failure?.description ?? 'Pick your seats on the map and they are held for five minutes.'
          }
          action={
            <Button asChild variant="solid" size="sm">
              <Link to={`/events/${eventId}/seats`}>Back to the seat map</Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-page px-gutter pb-24 pt-8 lg:px-gutter-lg">
      <Link
        to={`/events/${eventId}/seats`}
        className="inline-flex items-center gap-2 rounded-sm text-sm text-muted transition-colors duration-[var(--dur-fast)] hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden /> Back to seats
      </Link>

      <div className="mb-14 mt-8 flex flex-wrap items-end justify-between gap-6 border-b pb-8">
        <h1 className="font-display text-display-sm sm:text-display-md">Checkout</h1>
        <HoldCountdown expiresAt={expiresAt} onExpired={onExpired} />
      </div>

      <div className="grid gap-16 lg:grid-cols-[1fr_22rem] lg:gap-24">
        <motion.form
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.52, ease: [0.22, 0.61, 0.36, 1] }}
          className="order-2 flex max-w-reading flex-col gap-8 lg:order-1"
          onSubmit={(e) => {
            e.preventDefault();
            void pay();
          }}
        >
          <Label>Payment</Label>

          <div className="flex flex-col gap-3">
            <FieldLabel htmlFor="name">Name on card</FieldLabel>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>

          <div className="flex flex-col gap-3">
            <FieldLabel htmlFor="card">Card number</FieldLabel>
            <Input
              id="card"
              inputMode="numeric"
              value={cardNumber}
              onChange={(e) => setCardNumber(e.target.value)}
              required
            />
            <p className="text-xs leading-relaxed text-faint">
              Simulated. Nothing is charged or stored. A number ending 0000 is declined, so you can
              see that path too.
            </p>
          </div>

          {failure ? (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              role="alert"
              className="text-sm leading-relaxed text-danger"
            >
              <span className="text-foreground">{failure.title}.</span> {failure.description}
            </motion.p>
          ) : null}

          <Button type="submit" variant="solid" size="lg" disabled={pending || !seats}>
            {pending ? <Spinner /> : null}
            {pending ? 'Confirming' : `Pay ${formatPrice(total)}`}
          </Button>
        </motion.form>

        <aside className="order-1 flex flex-col gap-6 lg:order-2">
          <Label>Your order</Label>
          <div>
            <p className="font-display text-xl font-light">
              {formatEventName(event?.name ?? "") || <Skeleton className="h-6 w-48" />}
            </p>
            {event ? <p className="mt-1.5 text-sm text-muted">{event.venue}</p> : null}
          </div>

          {seats === null ? (
            <Skeleton className="h-16 w-full" />
          ) : (
            <ul className="flex flex-col border-t">
              {seats.map((seat) => (
                <li key={seat.id} className="flex items-center justify-between gap-4 border-b py-3.5 text-sm">
                  <span className="text-muted-foreground">
                    {seat.section} · Row {seat.row} · Seat {seat.number}
                  </span>
                  <span data-numeral>{formatPrice(seat.price)}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-baseline justify-between">
            <Label>Total</Label>
            <span data-numeral className="font-display text-3xl font-light">
              {formatPrice(total)}
            </span>
          </div>
        </aside>
      </div>
    </div>
  );
}
