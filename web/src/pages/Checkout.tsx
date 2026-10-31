import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { AlertCircle, ArrowLeft, Clock, CreditCard, Lock, TicketX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input, Label } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { HoldCountdown } from '@/components/seatmap/HoldCountdown';
import { api, ApiError } from '@/lib/api';
import type { EventSummary, HoldState, Seat } from '@/lib/types';
import { useAuthStore } from '@/store/auth';
import { formatPrice } from '@/lib/utils';

/** What went wrong, and what the buyer can actually do about it. */
type Failure = {
  title: string;
  description: string;
  action: 'back-to-seats' | 'retry';
};

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
  const token = useAuthStore((s) => s.token);

  const [event, setEvent] = useState<EventSummary | null>(null);
  const [seats, setSeats] = useState<Seat[] | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [pending, setPending] = useState(false);

  const [cardNumber, setCardNumber] = useState('4242 4242 4242 4242');
  const [name, setName] = useState('Test Buyer');

  useEffect(() => {
    if (!token) navigate(`/login?next=/events/${eventId}/checkout`, { replace: true });
  }, [token, eventId, navigate]);

  useEffect(() => {
    if (!token || !eventId) return;
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
  }, [token, eventId]);

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

  // Nothing held and nothing to retry: there is no checkout to show.
  if (seats !== null && seats.length === 0 && failure?.action !== 'retry') {
    return (
      <div className="mx-auto max-w-page px-gutter py-16 lg:px-gutter-lg">
        <EmptyState
          icon={failure ? Clock : TicketX}
          tone={failure ? 'danger' : 'neutral'}
          title={failure?.title ?? 'No seats held'}
          description={
            failure?.description ?? 'Pick your seats on the map and they are held for five minutes.'
          }
          action={
            <Button asChild variant="gradient" size="sm">
              <Link to={`/events/${eventId}/seats`}>Back to the seat map</Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-page px-gutter py-8 lg:px-gutter-lg">
      <Link
        to={`/events/${eventId}/seats`}
        className="mb-4 inline-flex items-center gap-1.5 rounded-md text-sm text-muted hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> Back to seats
      </Link>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-display-sm sm:text-display-md">Checkout</h1>
        {/* The countdown follows you here: these seats are only yours until it
            runs out, and hiding that would be the unkindest thing this screen
            could do. */}
        <HoldCountdown expiresAt={expiresAt} onExpired={onExpired} className="text-base" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <Card className="order-2 lg:order-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="size-4 text-muted" aria-hidden />
              Payment
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                void pay();
              }}
            >
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="name">Name on card</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="card">Card number</Label>
                <Input
                  id="card"
                  inputMode="numeric"
                  value={cardNumber}
                  onChange={(e) => setCardNumber(e.target.value)}
                  required
                />
                <p className="text-xs text-muted">
                  Mock payment — nothing is charged or stored. A number ending 0000 is declined,
                  so you can see what that looks like.
                </p>
              </div>

              {failure ? (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  role="alert"
                  className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2.5 text-sm text-danger"
                >
                  <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span>
                    <strong className="font-medium">{failure.title}.</strong>{' '}
                    {failure.description}
                  </span>
                </motion.div>
              ) : null}

              <Button type="submit" variant="gradient" size="lg" disabled={pending || !seats}>
                {pending ? <Spinner /> : <Lock aria-hidden />}
                {pending ? 'Confirming' : `Pay ${formatPrice(total)}`}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="order-1 h-fit lg:order-2">
          <CardHeader>
            <CardTitle>{event?.name ?? <Skeleton className="h-6 w-48" />}</CardTitle>
            {event ? <p className="text-sm text-muted">{event.venue}</p> : null}
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {seats === null ? (
              <>
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-2/3" />
              </>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {seats.map((seat) => (
                  <li key={seat.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span>
                      {seat.section} · Row {seat.row} · Seat {seat.number}
                    </span>
                    <span className="tabular-nums text-muted">{formatPrice(seat.price)}</span>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex items-center justify-between border-t border-border pt-3">
              <span className="text-sm text-muted">Total</span>
              <span className="font-display text-xl font-semibold tabular-nums">
                {formatPrice(total)}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
