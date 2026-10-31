import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Label, StatusLabel } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { EventFilters, EMPTY_FILTERS, type Filters } from '@/components/events/EventFilters';
import { ProvenanceLabel, SimulatedInventoryNote } from '@/components/events/Provenance';
import { api } from '@/lib/api';
import type { EventFacets, EventSummary, EventsResponse } from '@/lib/types';
import { formatDate, formatPrice } from '@/lib/utils';

const STATUS: Record<
  EventSummary['status'],
  { label: string; tone: 'live' | 'warning' | 'danger' | 'muted' }
> = {
  LIVE: { label: 'On sale now', tone: 'live' },
  PAUSED: { label: 'Paused', tone: 'warning' },
  UPCOMING: { label: 'Opening soon', tone: 'muted' },
  SOLD_OUT: { label: 'Sold out', tone: 'danger' },
  // Never reached from a public listing, which filters both out. Present so
  // the mapping is total and a status can never render as undefined.
  COMPLETED: { label: 'Finished', tone: 'muted' },
  CANCELLED: { label: 'Cancelled', tone: 'danger' },
};

/** The hero is the sale you can act on, not whichever is soonest. */
const PRIORITY: Record<EventSummary['status'], number> = {
  LIVE: 0,
  PAUSED: 1,
  UPCOMING: 2,
  SOLD_OUT: 3,
  COMPLETED: 4,
  CANCELLED: 5,
};

export default function Home() {
  const [events, setEvents] = useState<EventSummary[] | null>(null);
  const [facets, setFacets] = useState<EventFacets>({ categories: [], cities: [] });
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [failed, setFailed] = useState(false);

  // Filtering happens on the server so it works the same with three events or
  // three hundred. The search box is debounced so typing is not a request per
  // keystroke.
  useEffect(() => {
    const handle = setTimeout(() => {
      const params = new URLSearchParams();
      if (filters.q.trim()) params.set('q', filters.q.trim());
      if (filters.category) params.set('category', filters.category);
      if (filters.city) params.set('city', filters.city);
      const query = params.toString();

      api
        .get<EventsResponse>(`/api/events${query ? `?${query}` : ''}`)
        .then((res) => {
          setEvents(res.events);
          setFacets(res.facets);
          setFailed(false);
        })
        .catch(() => setFailed(true));
    }, filters.q ? 220 : 0);

    return () => clearTimeout(handle);
  }, [filters]);

  const ordered = useMemo(
    () => (events ? [...events].sort((a, b) => PRIORITY[a.status] - PRIORITY[b.status]) : null),
    [events],
  );

  const filtering = Boolean(filters.q || filters.category || filters.city);

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

  if (ordered === null) {
    return (
      <div className="mx-auto flex min-h-[70svh] max-w-page flex-col justify-center gap-8 px-gutter lg:px-gutter-lg">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-20 w-full max-w-2xl" />
        <Skeleton className="h-3 w-56" />
      </div>
    );
  }

  // While filtering, the hero would hide a result behind a full-height panel,
  // so the list stands on its own instead.
  const headline = filtering ? null : ordered[0];
  const rest = filtering ? ordered : ordered.slice(1);

  return (
    <div>
      {headline ? <Hero event={headline} /> : null}

      <section className="mx-auto max-w-page px-gutter pb-28 lg:px-gutter-lg">
        <EventFilters
          facets={facets}
          filters={filters}
          onChange={setFilters}
          resultCount={ordered.length}
        />

        {rest.length === 0 ? (
          <EmptyState
            title={filtering ? 'Nothing matches' : 'No other events'}
            description={
              filtering
                ? 'Try a different search, or clear the filters.'
                : 'Everything on sale is above.'
            }
            action={
              filtering ? (
                <Button variant="subtle" size="sm" onClick={() => setFilters(EMPTY_FILTERS)}>
                  Clear filters
                </Button>
              ) : null
            }
          />
        ) : (
          <>
            {!filtering ? <Label className="mt-12 block">Also on sale</Label> : null}
            <ul className={filtering ? 'mt-10' : ''}>
              {rest.map((event, i) => (
                <EventRow key={event.id} event={event} index={i} />
              ))}
            </ul>
          </>
        )}

        <SimulatedInventoryNote verbose className="mt-12 border-t pt-8" />
      </section>
    </div>
  );
}

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
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
          <StatusLabel tone={status.tone} pulse={event.status === 'LIVE'}>
            {status.label}
          </StatusLabel>
          <ProvenanceLabel event={event} />
        </div>

        <h1 className="max-w-5xl font-display text-display-md sm:text-display-lg lg:text-display-xl">
          {event.name}
        </h1>

        <p className="text-base text-muted-foreground">
          {event.venue}
          {event.city ? ` · ${event.city}` : ''} · {formatDate(event.startsAt)}
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

        <div className="flex flex-col gap-2">
          <p data-numeral className="text-sm text-faint">
            {event.totalSeats.toLocaleString()} seats · {formatPrice(event.minPrice)} to{' '}
            {formatPrice(event.maxPrice)}
          </p>
          <SimulatedInventoryNote />
        </div>
      </motion.div>
    </section>
  );
}

function EventRow({ event, index }: { event: EventSummary; index: number }) {
  const status = STATUS[event.status];
  const open = event.status === 'LIVE' || event.status === 'PAUSED';

  const body = (
    <div className="grid grid-cols-1 items-baseline gap-y-3 py-10 md:grid-cols-12 md:gap-x-8">
      <div className="md:col-span-5">
        <h2 className="font-display text-2xl font-light tracking-tight sm:text-3xl">{event.name}</h2>
        <p className="mt-2 text-sm text-muted">
          {event.venue}
          {event.city ? ` · ${event.city}` : ''}
        </p>
        <ProvenanceLabel event={event} className="mt-3" />
      </div>
      <p className="text-sm text-muted-foreground md:col-span-2">{formatDate(event.startsAt)}</p>
      <p data-numeral className="text-sm text-muted-foreground md:col-span-2">
        {formatPrice(event.minPrice)}–{formatPrice(event.maxPrice)}
      </p>
      <div className="md:col-span-3 md:text-right">
        <StatusLabel tone={status.tone} className="whitespace-nowrap">
          {status.label}
        </StatusLabel>
      </div>
    </div>
  );

  return (
    <motion.li
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.42, delay: Math.min(index, 6) * 0.04, ease: [0.22, 0.61, 0.36, 1] }}
      className="border-b"
    >
      {open ? (
        <Link
          to={`/events/${event.id}/queue`}
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
