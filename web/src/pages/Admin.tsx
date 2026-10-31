import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Label, StatusLabel } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { api, ApiError } from '@/lib/api';
import type { EventSummary } from '@/lib/types';
import { useAuthStore } from '@/store/auth';
import { toast } from '@/store/toast';
import { formatDate, formatPrice } from '@/lib/utils';

const STATUS_TONE: Record<EventSummary['status'], 'live' | 'warning' | 'danger' | 'muted'> = {
  LIVE: 'live',
  PAUSED: 'warning',
  SOLD_OUT: 'danger',
  UPCOMING: 'muted',
};

/**
 * Pausing a sale is the only control that matters here: it stops the worker
 * admitting anyone while the queue keeps accepting joiners, so nobody loses
 * their place while an admin works out what went wrong.
 */
export default function Admin() {
  const user = useAuthStore((s) => s.user);
  const [events, setEvents] = useState<EventSummary[] | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function load() {
    try {
      const res = await api.get<{ events: EventSummary[] }>('/api/events');
      setEvents(res.events);
    } catch {
      setEvents([]);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function setStatus(event: EventSummary, status: 'LIVE' | 'PAUSED') {
    setPendingId(event.id);
    try {
      await api.post(`/api/admin/events/${event.id}/status`, { status });
      toast.success(status === 'PAUSED' ? 'Queue paused' : 'Queue resumed', event.name);
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not change the sale');
    } finally {
      setPendingId(null);
    }
  }

  if (user && user.role !== 'ADMIN') {
    return (
      <div className="mx-auto max-w-page px-gutter lg:px-gutter-lg">
        <EmptyState
          tone="danger"
          title="Admins only"
          description="Sign in with the admin account to control a sale."
          action={
            <Button asChild variant="subtle" size="sm">
              <Link to="/login?next=/admin">Sign in</Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-page px-gutter pb-24 pt-8 lg:px-gutter-lg">
      <div className="border-b pb-8">
        <Label>Admin</Label>
        <h1 className="mt-3 font-display text-display-sm sm:text-display-md">Sales</h1>
      </div>

      {events === null ? (
        <div className="flex flex-col gap-px pt-8">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : (
        <ul>
          {events.map((event) => (
            <li
              key={event.id}
              className="grid grid-cols-1 items-center gap-y-4 border-b py-8 md:grid-cols-12 md:gap-x-8"
            >
              <div className="md:col-span-5">
                <p className="font-display text-xl font-light">{event.name}</p>
                <p className="mt-1.5 text-sm text-muted">{event.venue}</p>
              </div>
              <p className="text-sm text-muted-foreground md:col-span-2">
                {formatDate(event.startsAt)}
              </p>
              <p data-numeral className="text-sm text-muted-foreground md:col-span-2">
                {event.availableSeats.toLocaleString()} of {event.totalSeats.toLocaleString()} left
              </p>
              <div className="md:col-span-1">
                <StatusLabel tone={STATUS_TONE[event.status]}>{event.status}</StatusLabel>
              </div>
              <div className="md:col-span-2 md:text-right">
                {event.status === 'LIVE' || event.status === 'PAUSED' ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pendingId === event.id}
                    onClick={() =>
                      void setStatus(event, event.status === 'LIVE' ? 'PAUSED' : 'LIVE')
                    }
                  >
                    {event.status === 'LIVE' ? 'Pause' : 'Resume'}
                  </Button>
                ) : (
                  <span className="text-xs text-faint">
                    {event.status === 'SOLD_OUT' ? 'Sold out' : formatPrice(event.minPrice)}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-8 max-w-reading text-xs leading-relaxed text-faint">
        Pausing stops the worker admitting anyone. The queue keeps accepting joiners, so nobody
        loses their place while a sale is held.
      </p>
    </div>
  );
}
