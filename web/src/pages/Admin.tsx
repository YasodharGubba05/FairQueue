import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Label, StatusLabel } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { ProvenanceLabel } from '@/components/events/Provenance';
import { api, ApiError } from '@/lib/api';
import type { AdminEvent } from '@/lib/types';
import { useAuthStore } from '@/store/auth';
import { toast } from '@/store/toast';
import { formatDate, formatEventName } from '@/lib/utils';

const TONE: Record<AdminEvent['status'], 'live' | 'warning' | 'danger' | 'muted'> = {
  LIVE: 'live',
  PAUSED: 'warning',
  SOLD_OUT: 'danger',
  CANCELLED: 'danger',
  COMPLETED: 'muted',
  UPCOMING: 'muted',
};

const TERMINAL: AdminEvent['status'][] = ['COMPLETED', 'CANCELLED'];

/**
 * Admin reads its own endpoint rather than the public one, because the public
 * listing now hides finished and cancelled events — which are exactly the ones
 * an admin needs to see.
 */
export default function Admin() {
  const user = useAuthStore((s) => s.user);
  const [events, setEvents] = useState<AdminEvent[] | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);

  async function load() {
    try {
      const res = await api.get<{ events: AdminEvent[] }>('/api/admin/events');
      setEvents(res.events);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setDenied(true);
      else setEvents([]);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function setStatus(event: AdminEvent, status: 'LIVE' | 'PAUSED' | 'CANCELLED') {
    if (status === 'CANCELLED') {
      // Cancelling is final, so it asks first.
      const ok = window.confirm(
        `Cancel "${formatEventName(event.name)}"?\n\nIt will disappear from every public listing and cannot be reopened. Tickets already sold are kept.`,
      );
      if (!ok) return;
    }

    setPendingId(event.id);
    try {
      await api.post(`/api/admin/events/${event.id}/status`, { status });
      toast.success(
        status === 'CANCELLED' ? 'Event cancelled' : status === 'PAUSED' ? 'Queue paused' : 'Queue resumed',
        event.name,
      );
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not change the sale');
    } finally {
      setPendingId(null);
    }
  }

  if (denied || (user && user.role !== 'ADMIN')) {
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
        <p className="mt-4 max-w-reading text-sm text-muted-foreground">
          Every event, including the finished and cancelled ones the public can no longer see.
        </p>
      </div>

      {events === null ? (
        <div className="flex flex-col gap-px pt-8">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : (
        <ul>
          {events.map((event) => {
            const terminal = TERMINAL.includes(event.status);
            return (
              <li
                key={event.id}
                className={`grid grid-cols-1 items-center gap-y-4 border-b py-8 md:grid-cols-12 md:gap-x-8 ${
                  terminal ? 'opacity-50' : ''
                }`}
              >
                <div className="md:col-span-5">
                  <p className="font-display text-xl font-light">{formatEventName(event.name)}</p>
                  <p className="mt-1.5 text-sm text-muted">
                    {event.venue}
                    {event.city ? ` · ${event.city}` : ''}
                  </p>
                  <ProvenanceLabel event={event} className="mt-3" />
                </div>

                <p className="text-sm text-muted-foreground md:col-span-2">
                  {formatDate(event.startsAt)}
                </p>

                <p data-numeral className="text-sm text-muted-foreground md:col-span-2">
                  {event.ticketsSold.toLocaleString()} of {event.totalSeats.toLocaleString()} sold
                </p>

                <div className="md:col-span-1">
                  <StatusLabel tone={TONE[event.status]} className="whitespace-nowrap">
                    {event.status}
                  </StatusLabel>
                  {!event.publiclyVisible ? (
                    <p className="mt-1.5 text-xs text-faint">Hidden from buyers</p>
                  ) : null}
                </div>

                <div className="flex gap-3 md:col-span-2 md:justify-end">
                  {terminal ? (
                    <span className="text-xs text-faint">No actions</span>
                  ) : (
                    <>
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
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pendingId === event.id}
                        onClick={() => void setStatus(event, 'CANCELLED')}
                      >
                        Cancel
                      </Button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-10 max-w-reading text-xs leading-relaxed text-faint">
        Pausing stops the worker admitting anyone while the queue keeps accepting joiners, so nobody
        loses their place. Cancelling is final and removes the event from every public listing;
        tickets already sold are kept and their order pages keep working.
      </p>
    </div>
  );
}
