import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, MapPin, Ticket, Users, WifiOff } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import type { EventSummary } from '@/lib/types';
import { formatDate, formatPrice, formatTime, gradientFor } from '@/lib/utils';

/**
 * The event list. P6 adds the hero sale with its countdown and the full polish
 * pass; this is the working grid that gets you into a queue.
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

  return (
    <div className="mx-auto max-w-page px-gutter py-10 lg:px-gutter-lg lg:py-14">
      <header className="flex flex-col gap-3">
        <h1 className="font-display text-display-sm sm:text-display-md">On sale</h1>
        <p className="max-w-prose text-muted">
          Everyone goes through the same line, in the order they arrived. No refreshing
          contest, no bots jumping ahead.
        </p>
      </header>

      {failed ? (
        <EmptyState
          className="mt-10"
          icon={WifiOff}
          tone="danger"
          title="Could not load events"
          description="The api is not answering. Start it with `make dev-api` and reload."
          action={
            <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
              Try again
            </Button>
          }
        />
      ) : null}

      {!failed && events === null ? (
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Card key={i} className="overflow-hidden">
              <Skeleton className="h-36 rounded-none" />
              <div className="flex flex-col gap-3 p-5">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-9 w-full" />
              </div>
            </Card>
          ))}
        </div>
      ) : null}

      {events !== null && events.length === 0 ? (
        <EmptyState
          className="mt-10"
          icon={Ticket}
          title="No events yet"
          description="Create one from the admin page."
        />
      ) : null}

      {events !== null && events.length > 0 ? (
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {events.map((event) => (
            <EventCard key={event.id} event={event} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

const STATUS: Record<
  EventSummary['status'],
  { label: string; variant: 'neutral' | 'accent' | 'live' | 'warning' | 'danger' }
> = {
  UPCOMING: { label: 'Upcoming', variant: 'accent' },
  LIVE: { label: 'On sale now', variant: 'live' },
  PAUSED: { label: 'Paused', variant: 'warning' },
  SOLD_OUT: { label: 'Sold out', variant: 'danger' },
};

function EventCard({ event }: { event: EventSummary }) {
  const status = STATUS[event.status];
  const open = event.status === 'LIVE' || event.status === 'PAUSED';

  return (
    <Card className="flex flex-col overflow-hidden transition-shadow hover:shadow-raised">
      {/* Abstract artwork derived from the event id: no real images or logos. */}
      <div
        className="relative h-36 w-full"
        style={{ background: gradientFor(event.id) }}
        aria-hidden
      >
        <div className="absolute inset-0 bg-gradient-to-t from-surface/90 to-transparent" />
      </div>

      <div className="flex flex-1 flex-col gap-3 p-5">
        <div className="flex items-start justify-between gap-2">
          <h2 className="font-display text-lg font-semibold leading-tight">{event.name}</h2>
          <Badge variant={status.variant} className="shrink-0">
            {status.label}
          </Badge>
        </div>

        <dl className="flex flex-col gap-1.5 text-sm text-muted">
          <div className="flex items-center gap-2">
            <MapPin className="size-3.5 shrink-0" aria-hidden />
            <dd className="truncate">{event.venue}</dd>
          </div>
          <div className="flex items-center gap-2">
            <CalendarDays className="size-3.5 shrink-0" aria-hidden />
            <dd>
              {formatDate(event.startsAt)} · {formatTime(event.startsAt)}
            </dd>
          </div>
          <div className="flex items-center gap-2">
            <Users className="size-3.5 shrink-0" aria-hidden />
            <dd>
              {event.availableSeats.toLocaleString()} of {event.totalSeats.toLocaleString()} seats left
            </dd>
          </div>
        </dl>

        <p className="mt-auto pt-2 text-sm font-medium">
          {formatPrice(event.minPrice)} – {formatPrice(event.maxPrice)}
        </p>

        {open ? (
          <Button asChild variant="gradient" className="w-full">
            <Link to={`/events/${event.id}/queue`}>Join the queue</Link>
          </Button>
        ) : (
          <Button variant="secondary" className="w-full" disabled>
            {event.status === 'SOLD_OUT' ? 'Sold out' : 'Sale not open yet'}
          </Button>
        )}
      </div>
    </Card>
  );
}
