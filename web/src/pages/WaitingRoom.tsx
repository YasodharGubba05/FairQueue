import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, Clock, Hash, PauseCircle, Users, WifiOff } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { PositionRing } from '@/components/queue/PositionRing';
import { api, ApiError } from '@/lib/api';
import { getSocket, subscribeToEvent } from '@/lib/socket';
import type { EventSummary, QueueState, QueueTick } from '@/lib/types';
import { useAuthStore } from '@/store/auth';
import { useQueueStore } from '@/store/queue';

/** "about 2 min", "about 40 sec" — a calm estimate, never a false precision. */
function formatWait(seconds: number) {
  if (seconds <= 0) return 'any moment now';
  if (seconds < 60) return `about ${Math.max(5, Math.ceil(seconds / 5) * 5)} sec`;
  const minutes = Math.ceil(seconds / 60);
  return `about ${minutes} min`;
}

export default function WaitingRoom() {
  const { eventId = '' } = useParams();
  const navigate = useNavigate();
  const token = useAuthStore((s) => s.token);
  const setNumber = useQueueStore((s) => s.setNumber);
  const savedNumber = useQueueStore((s) => s.numbers[eventId]);

  const [event, setEvent] = useState<EventSummary | null>(null);
  const [queue, setQueue] = useState<QueueState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState(true);

  // How many people were in front when you joined, so the ring has something to
  // fill up against. Kept in a ref so a re-render never moves the goalposts.
  const startAhead = useRef<number | null>(null);

  // Not signed in: one queue spot per account, so we need to know who you are.
  useEffect(() => {
    if (!token) navigate(`/login?next=/events/${eventId}/queue`, { replace: true });
  }, [token, eventId, navigate]);

  // Join on load. The endpoint is idempotent, so this is also what a refresh or
  // a reconnect does: it returns the number you already had.
  useEffect(() => {
    if (!token || !eventId) return;
    let cancelled = false;

    async function start() {
      try {
        const [eventRes, state] = await Promise.all([
          api.get<{ event: EventSummary }>(`/api/events/${eventId}`),
          api.post<QueueState>(`/api/events/${eventId}/queue/join`),
        ]);
        if (cancelled) return;
        setEvent(eventRes.event);
        setQueue(state);
        if (state.joinNumber !== null) {
          setNumber(eventId, state.joinNumber);
          if (startAhead.current === null) startAhead.current = state.ahead;
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Could not reach the server');
        }
      }
    }

    void start();
    return () => {
      cancelled = true;
    };
  }, [token, eventId, setNumber]);

  // Follow the broadcast: one message per event per second, for everybody.
  useEffect(() => {
    if (!eventId) return;
    const socket = getSocket();
    const unsubscribe = subscribeToEvent(eventId);

    const onTick = (tick: QueueTick) => {
      if (tick.eventId !== eventId) return;
      setQueue((prev) =>
        prev === null
          ? prev
          : {
              ...prev,
              admitted: tick.admitted,
              joined: tick.joined,
              admitPerSec: tick.admitPerSec,
              status: tick.status,
              ahead:
                prev.joinNumber === null ? 0 : Math.max(0, prev.joinNumber - tick.admitted),
            },
      );
    };

    const onConnect = () => setOnline(true);
    const onDisconnect = () => setOnline(false);

    socket.on('queue:tick', onTick);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    setOnline(socket.connected);

    return () => {
      socket.off('queue:tick', onTick);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      unsubscribe();
    };
  }, [eventId]);

  const refresh = useCallback(async () => {
    try {
      const state = await api.get<QueueState>(`/api/events/${eventId}/queue`);
      setQueue(state);
    } catch {
      // The broadcast is the normal path; a failed poll is not worth a message.
    }
  }, [eventId]);

  // A slow safety net in case the socket is down or a broadcast was missed.
  useEffect(() => {
    if (!token || !eventId) return;
    const id = setInterval(() => void refresh(), 5000);
    return () => clearInterval(id);
  }, [token, eventId, refresh]);

  // Reached the front but no pass yet: ask the server, since the pass is
  // issued by the worker a moment after the watermark passes your number.
  useEffect(() => {
    if (!queue || queue.joinNumber === null || queue.hasPass) return;
    if (queue.ahead === 0) void refresh();
  }, [queue, refresh]);

  // Admitted: show "You're in" for a beat, then go to the seats. This depends
  // on the boolean alone, not the whole queue object — the object is replaced
  // every second by the broadcast, and that would cancel and restart the timer
  // forever without it ever firing.
  const hasPass = queue?.hasPass ?? false;
  useEffect(() => {
    if (!hasPass) return;
    const id = setTimeout(() => navigate(`/events/${eventId}/seats`), 1200);
    return () => clearTimeout(id);
  }, [hasPass, eventId, navigate]);

  if (error) {
    return (
      <div className="mx-auto max-w-page px-gutter py-16 lg:px-gutter-lg">
        <EmptyState
          icon={AlertCircle}
          tone="danger"
          title="Could not take your place in line"
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

  if (!queue || !event) {
    return (
      <div className="mx-auto flex max-w-xl flex-col items-center gap-6 px-gutter py-16">
        <Skeleton className="size-[260px] rounded-full" />
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-4 w-72" />
      </div>
    );
  }

  const joinNumber = queue.joinNumber ?? savedNumber ?? 0;
  const total = startAhead.current ?? queue.ahead;
  const progress = total <= 0 ? 1 : (total - queue.ahead) / total;
  const waitSeconds = queue.admitPerSec > 0 ? Math.ceil(queue.ahead / queue.admitPerSec) : 0;
  const paused = queue.status === 'PAUSED';

  return (
    <div className="mx-auto flex max-w-xl flex-col items-center px-gutter py-10 text-center sm:py-16">
      <AnimatePresence>
        {!online ? (
          <motion.p
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            role="status"
            className="mb-6 flex items-center gap-2 rounded-full border border-warning/30 bg-warning/10 px-4 py-2 text-sm text-warning"
          >
            <WifiOff className="size-4" aria-hidden />
            Reconnecting — your place is saved
          </motion.p>
        ) : null}
      </AnimatePresence>

      <Badge variant={paused ? 'warning' : 'live'} className="mb-4">
        {paused ? (
          <>
            <PauseCircle className="size-3" aria-hidden /> Queue paused
          </>
        ) : (
          'In the queue'
        )}
      </Badge>

      <h1 className="font-display text-display-sm sm:text-display-md">{event.name}</h1>
      <p className="mt-1 text-sm text-muted">{event.venue}</p>

      <div className="my-10">
        <PositionRing ahead={queue.ahead} progress={progress} admitted={queue.hasPass} />
      </div>

      {/* The screen is live and reassuring text matters more than numbers here. */}
      <p aria-live="polite" className="max-w-sm text-balance text-muted">
        {queue.hasPass
          ? 'Your turn. Opening the seat map — your seats are held while you choose.'
          : paused
            ? 'The sale is paused for a moment. Nobody behind you can get ahead, so you can leave this tab open.'
            : 'You are through as soon as the people in front of you are done. Keep this tab open — refreshing will not cost you your place.'}
      </p>

      <div className="mt-8 grid w-full gap-3 sm:grid-cols-3">
        <Stat icon={Hash} label="Your number" value={joinNumber.toLocaleString()} />
        <Stat
          icon={Clock}
          label="Estimated wait"
          value={queue.hasPass ? 'none' : paused ? 'paused' : formatWait(waitSeconds)}
        />
        <Stat icon={Users} label="In line" value={Math.max(0, queue.joined - queue.admitted).toLocaleString()} />
      </div>

      <p className="mt-6 text-xs text-muted">
        {queue.admitPerSec.toLocaleString()} people are let in every second, in the order they
        joined.
      </p>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Clock;
  label: string;
  value: string;
}) {
  return (
    <Card className="flex flex-col items-center gap-1 p-4">
      <Icon className="size-4 text-muted" aria-hidden />
      <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
      <dd className="font-display text-lg font-semibold tabular-nums">{value}</dd>
    </Card>
  );
}
