import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, WifiOff } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { SeatMapCanvas } from '@/components/seatmap/SeatMapCanvas';
import { SelectionTray } from '@/components/seatmap/SelectionTray';
import { api, ApiError } from '@/lib/api';
import { getSocket, subscribeToEvent } from '@/lib/socket';
import type { EventSummary, HoldState, Seat, SeatStatus, SeatsUpdate } from '@/lib/types';
import { useAuthStore } from '@/store/auth';
import { toast } from '@/store/toast';

export default function SeatMap() {
  const { eventId = '' } = useParams();
  const navigate = useNavigate();
  const token = useAuthStore((s) => s.token);

  const [event, setEvent] = useState<EventSummary | null>(null);
  const [seats, setSeats] = useState<Seat[] | null>(null);
  const [statuses, setStatuses] = useState<Record<string, SeatStatus>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState(true);

  // Clicks can outrun the network, so one hold request is in flight at a time.
  const inFlight = useRef(false);

  useEffect(() => {
    if (!token) navigate(`/login?next=/events/${eventId}/seats`, { replace: true });
  }, [token, eventId, navigate]);

  useEffect(() => {
    if (!token || !eventId) return;
    let cancelled = false;

    async function load() {
      try {
        const [eventRes, seatRes, holds] = await Promise.all([
          api.get<{ event: EventSummary }>(`/api/events/${eventId}`),
          api.get<{ seats: Seat[] }>(`/api/events/${eventId}/seats`),
          api.get<HoldState>(`/api/events/${eventId}/holds`),
        ]);
        if (cancelled) return;

        setEvent(eventRes.event);
        setSeats(seatRes.seats);
        setStatuses(Object.fromEntries(seatRes.seats.map((s) => [s.id, s.status])));
        // Seats held from an earlier visit are still yours, so the selection
        // and its countdown come back exactly as they were.
        setSelected(new Set(holds.seatIds));
        setExpiresAt(holds.expiresAt);
      } catch (err) {
        if (cancelled) return;
        // No pass means this buyer has not been through the line yet.
        if (err instanceof ApiError && err.status === 403) {
          navigate(`/events/${eventId}/queue`, { replace: true });
          return;
        }
        setError(err instanceof ApiError ? err.message : 'Could not load the seat map');
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [token, eventId, navigate]);

  // Live seat changes, arriving in batches of up to four a second.
  useEffect(() => {
    if (!eventId) return;
    const socket = getSocket();
    const unsubscribe = subscribeToEvent(eventId);

    const onSeats = (update: SeatsUpdate) => {
      if (update.eventId !== eventId) return;
      setStatuses((prev) => {
        const next = { ...prev };
        for (const s of update.seats) next[s.id] = s.status;
        return next;
      });
      // A seat of ours going sold elsewhere means our hold is gone.
      setSelected((prev) => {
        const lost = update.seats.filter((s) => prev.has(s.id) && s.status !== 'held');
        if (lost.length === 0) return prev;
        const next = new Set(prev);
        for (const s of lost) next.delete(s.id);
        return next;
      });
    };

    const onConnect = () => setOnline(true);
    const onDisconnect = () => setOnline(false);

    socket.on('seats:update', onSeats);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    setOnline(socket.connected);

    return () => {
      socket.off('seats:update', onSeats);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      unsubscribe();
    };
  }, [eventId]);

  const pick = useCallback(
    async (seat: Seat) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setPending(true);

      const isSelected = selected.has(seat.id);
      try {
        if (isSelected) {
          await api.del<{ released: string[] }>(`/api/events/${eventId}/holds`, {
            seatIds: [seat.id],
          });
          setSelected((prev) => {
            const next = new Set(prev);
            next.delete(seat.id);
            return next;
          });
          setStatuses((prev) => ({ ...prev, [seat.id]: 'available' }));
        } else {
          const res = await api.post<{ seatIds: string[]; expiresAt: number }>(
            `/api/events/${eventId}/holds`,
            { seatIds: [seat.id] },
          );
          setSelected((prev) => new Set(prev).add(seat.id));
          setStatuses((prev) => ({ ...prev, [seat.id]: 'held' }));
          setExpiresAt(res.expiresAt);
        }
      } catch (err) {
        const message = err instanceof ApiError ? err.message : 'That did not work';
        if (err instanceof ApiError && err.status === 403) {
          navigate(`/events/${eventId}/queue`, { replace: true });
          return;
        }
        // Somebody beat us to it: show the seat as taken rather than leaving it
        // looking free and clickable.
        if (err instanceof ApiError && err.status === 409) {
          setStatuses((prev) => ({
            ...prev,
            [seat.id]: message.includes('sold') ? 'sold' : 'held',
          }));
        }
        toast.warning(message);
      } finally {
        inFlight.current = false;
        setPending(false);
      }
    },
    [eventId, selected, navigate],
  );

  const onExpired = useCallback(() => {
    setSelected(new Set());
    setExpiresAt(null);
    toast.warning('Your hold ran out', 'Those seats are back on sale. Pick again to carry on.');
  }, []);

  const selectedSeats = useMemo(
    () => (seats ?? []).filter((s) => selected.has(s.id)),
    [seats, selected],
  );

  if (error) {
    return (
      <div className="mx-auto max-w-page px-gutter py-16 lg:px-gutter-lg">
        <EmptyState
          icon={AlertCircle}
          tone="danger"
          title="Could not load the seat map"
          description={error}
          action={
            <Button asChild variant="secondary" size="sm">
              <Link to="/">Back to events</Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-page px-gutter py-8 pb-40 lg:px-gutter-lg">
      <Link
        to="/"
        className="mb-4 inline-flex items-center gap-1.5 rounded-md text-sm text-muted hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> All events
      </Link>

      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-display-sm sm:text-display-md">
            {event?.name ?? <Skeleton className="h-9 w-72" />}
          </h1>
          {event ? <p className="mt-1 text-sm text-muted">{event.venue}</p> : null}
        </div>
        <div className="flex items-center gap-2">
          {!online ? (
            <Badge variant="warning">
              <WifiOff className="size-3" aria-hidden /> Reconnecting
            </Badge>
          ) : (
            <Badge variant="live">Live</Badge>
          )}
          {event ? <Badge variant="neutral">Up to {event.maxSeatsPerUser} seats</Badge> : null}
        </div>
      </div>

      {seats === null ? (
        <Skeleton className="h-[clamp(380px,60vh,720px)] w-full rounded-xl" />
      ) : (
        <SeatMapCanvas
          seats={seats}
          statuses={statuses}
          selected={selected}
          onPick={(seat) => void pick(seat)}
        />
      )}

      <p className="mt-4 text-sm text-muted">
        Pick a seat and it is held for you for five minutes. Scroll to zoom, drag to move, or use
        the arrow keys and Enter.
      </p>

      <SelectionTray
        seats={selectedSeats}
        expiresAt={expiresAt}
        pending={pending}
        onRemove={(seat) => void pick(seat)}
        onContinue={() => navigate(`/events/${eventId}/checkout`)}
        onExpired={onExpired}
      />
    </div>
  );
}
