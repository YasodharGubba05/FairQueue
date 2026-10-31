import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Label, StatusLabel } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import type { EventSummary } from '@/lib/types';
import { formatDate, formatPrice } from '@/lib/utils';

/**
 * The event list, built as full-height panels rather than a grid of cards.
 * There is no artwork: in this system an event is its name, set large, and the
 * three facts you need to decide — where, when, how much.
 */
export default function Home() {
  const [events, setEvents] = useState<EventSummary[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api
      .get<{ events: EventSummary[] }>('/api/events')
      .then((res) => setEvents(res.events))
      .catch(() => setFailed(true));
  }, []);

  if (failed) {
    return (
      <div className="mx-auto max-w-page px-gutter lg:px-gutter-lg">
        <EmptyState
          tone="danger"
          title="Could not load events"
          description="The api is not answering. Start it and reload."
          action={
            <Button variant="subtle" size="sm" onClick={() => window.location.reload()}>
              Try again
            </Button>
          }
        />
      </div>
    );
  }

  if (events === null) {
    return (
      <div className="mx-auto flex min-h-[70svh] max-w-page flex-col justify-center gap-8 px-gutter lg:px-gutter-lg">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-20 w-full max-w-2xl" />
        <Skeleton className="h-3 w-56" />
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="mx-auto max-w-page px-gutter lg:px-gutter-lg">
        <EmptyState title="No events yet" description="Create one from the admin page." />
      </div>
    );
  }

  // The hero is the sale you can actually act on. Ordering by date would put a
  // sold-out show at the top, which is the least useful thing to lead with.
  const PRIORITY: Record<EventSummary['status'], number> = {
    LIVE: 0,
    PAUSED: 1,
    UPCOMING: 2,
    SOLD_OUT: 3,
  };
  const ordered = [...events].sort((a, b) => PRIORITY[a.status] - PRIORITY[b.status]);
  const [headline, ...rest] = ordered;

  return (
    <div>
      <Hero event={headline} />

      {rest.length > 0 ? (
        <section className="mx-auto max-w-page px-gutter pb-24 lg:px-gutter-lg">
          <Label className="block border-t pt-8">Also on sale</Label>
          <ul>
            {rest.map((event, i) => (
              <EventRow key={event.id} event={event} index={i} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

const STATUS: Record<EventSummary['status'], { label: string; tone: 'live' | 'warning' | 'danger' | 'muted' }> = {
  LIVE: { label: 'On sale now', tone: 'live' },
  PAUSED: { label: 'Paused', tone: 'warning' },
  UPCOMING: { label: 'Opening soon', tone: 'muted' },
  SOLD_OUT: { label: 'Sold out', tone: 'danger' },
};

function Hero({ event }: { event: EventSummary }) {
  const status = STATUS[event.status];
  const open = event.status === 'LIVE' || event.status === 'PAUSED';

  return (
    <section className="mx-auto flex min-h-[calc(100svh-var(--spacing-nav,4.5rem))] max-w-page flex-col justify-center px-gutter py-20 lg:px-gutter-lg">
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.68, ease: [0.22, 0.61, 0.36, 1] }}
        className="flex flex-col items-start gap-8"
      >
        <StatusLabel tone={status.tone} pulse={event.status === 'LIVE'}>
          {status.label}
        </StatusLabel>

        <h1 className="max-w-5xl font-display text-display-md sm:text-display-lg lg:text-display-xl">
          {event.name}
        </h1>

        <p className="text-base text-muted-foreground">
          {event.venue} · {formatDate(event.startsAt)}
        </p>

        <div className="mt-2 flex flex-col gap-3 sm:flex-row">
          {open ? (
            <>
              <Button asChild variant="solid" size="lg" className="w-full sm:w-52">
                <Link to={`/events/${event.id}/queue`}>Join the queue</Link>
              </Button>
              <Button asChild variant="subtle" size="lg" className="w-full sm:w-52">
                <Link to={`/events/${event.id}/seats`}>View seats</Link>
              </Button>
            </>
          ) : (
            <Button variant="subtle" size="lg" className="w-full sm:w-52" disabled>
              {event.status === 'SOLD_OUT' ? 'Sold out' : 'Not open yet'}
            </Button>
          )}
        </div>

        <p data-numeral className="mt-4 text-sm text-faint">
          {event.totalSeats.toLocaleString()} seats · {formatPrice(event.minPrice)} to{' '}
          {formatPrice(event.maxPrice)}
        </p>
      </motion.div>
    </section>
  );
}

function EventRow({ event, index }: { event: EventSummary; index: number }) {
  const status = STATUS[event.status];
  const open = event.status === 'LIVE' || event.status === 'PAUSED';
  const href = open ? `/events/${event.id}/queue` : null;

  const body = (
    <div className="grid grid-cols-1 items-baseline gap-y-3 py-10 md:grid-cols-12 md:gap-x-8">
      <div className="md:col-span-6">
        <h2 className="font-display text-2xl font-light tracking-tight sm:text-3xl">{event.name}</h2>
        <p className="mt-2 text-sm text-muted">{event.venue}</p>
      </div>
      <p className="text-sm text-muted-foreground md:col-span-2">{formatDate(event.startsAt)}</p>
      <p data-numeral className="text-sm text-muted-foreground md:col-span-2">
        {formatPrice(event.minPrice)}–{formatPrice(event.maxPrice)}
      </p>
      <div className="md:col-span-2 md:text-right">
        <StatusLabel tone={status.tone} className="whitespace-nowrap">
          {status.label}
        </StatusLabel>
      </div>
    </div>
  );

  return (
    <motion.li
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.42, delay: index * 0.05, ease: [0.22, 0.61, 0.36, 1] }}
      className="border-b"
    >
      {href ? (
        <Link
          to={href}
          className="block rounded-sm transition-opacity duration-[var(--dur-fast)] hover:opacity-70"
        >
          {body}
        </Link>
      ) : (
        <div className="opacity-45">{body}</div>
      )}
    </motion.li>
  );
}
