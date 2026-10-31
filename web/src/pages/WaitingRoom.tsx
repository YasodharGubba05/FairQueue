import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Label, StatusLabel } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { PositionNumber } from '@/components/queue/PositionNumber';
import { api, ApiError } from '@/lib/api';
import { getSocket, subscribeToEvent } from '@/lib/socket';
import type { EventSummary, QueueState, QueueTick } from '@/lib/types';
import { useQueueStore } from '@/store/queue';

/** "About 2 minutes" — a calm estimate, never a false precision. */
function formatWait(seconds: number) {
  if (seconds <= 0) return 'Any moment now';
  if (seconds < 60) return `About ${Math.max(5, Math.ceil(seconds / 5) * 5)} seconds`;
  const minutes = Math.ceil(seconds / 60);
  return `About ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
}

export default function WaitingRoom() {
  const { eventId = '' } = useParams();
  const navigate = useNavigate();
  const setNumber = useQueueStore((s) => s.setNumber);
  const savedNumber = useQueueStore((s) => s.numbers[eventId]);

  const [event, setEvent] = useState<EventSummary | null>(null);
  const [queue, setQueue] = useState<QueueState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState(true);

  // How many were in front when you joined, so the line has something to fill
  // against. A ref, so a re-render never moves the goalposts.
  const startAhead = useRef<number | null>(null);

  // Joining is idempotent, so this is also what a refresh does: it hands back
  // the number you already had.
  useEffect(() => {
    if (!eventId) return;
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
  }, [eventId, setNumber]);

  // One broadcast a second, for everyone watching this event.
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
              ahead: prev.joinNumber === null ? 0 : Math.max(0, prev.joinNumber - tick.admitted),
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
      setQueue(await api.get<QueueState>(`/api/events/${eventId}/queue`));
    } catch {
      // The broadcast is the normal path; a failed poll is not worth a message.
    }
  }, [eventId]);

  // A slow safety net in case the socket is down or a broadcast was missed.
  useEffect(() => {
    if (!eventId) return;
    const id = setInterval(() => void refresh(), 5000);
    return () => clearInterval(id);
  }, [eventId, refresh]);

  // At the front but no pass yet: the worker issues it a moment after the
  // watermark passes your number, so ask.
  useEffect(() => {
    if (!queue || queue.joinNumber === null || queue.hasPass) return;
    if (queue.ahead === 0) void refresh();
  }, [queue, refresh]);

  // Admitted. This depends on the boolean alone, not the whole queue object:
  // the object is replaced every second, which would cancel and restart the
  // timer forever without it ever firing.
  const hasPass = queue?.hasPass ?? false;
  useEffect(() => {
    if (!hasPass) return;
    const id = setTimeout(() => navigate(`/events/${eventId}/seats`), 1400);
    return () => clearTimeout(id);
  }, [hasPass, eventId, navigate]);

  if (error) {
    return (
      <div className="mx-auto max-w-page px-gutter lg:px-gutter-lg">
        <EmptyState
          tone="danger"
          title="Could not take your place in line"
          description={error}
          action={
            <Button asChild variant="subtle" size="sm">
              <Link to="/">Back to events</Link>
            </Button>
          }
        />
      </div>
    );
  }

  if (!queue || !event) {
    return (
      <div className="mx-auto flex min-h-[70svh] max-w-page flex-col items-center justify-center gap-8 px-gutter">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-28 w-56" />
        <Skeleton className="h-px w-full max-w-sm" />
      </div>
    );
  }

  const joinNumber = queue.joinNumber ?? savedNumber ?? 0;
  const total = startAhead.current ?? queue.ahead;
  const progress = total <= 0 ? 1 : (total - queue.ahead) / total;
  const waitSeconds = queue.admitPerSec > 0 ? Math.ceil(queue.ahead / queue.admitPerSec) : 0;
  const paused = queue.status === 'PAUSED';

  return (
    <div className="mx-auto flex min-h-[calc(100svh-var(--spacing-nav,4.5rem))] max-w-page flex-col px-gutter pb-16 lg:px-gutter-lg">
      <AnimatePresence>
        {!online ? (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            role="status"
            className="border-b py-3 text-center"
          >
            <Label tone="warning">Reconnecting — your place is saved</Label>
          </motion.p>
        ) : null}
      </AnimatePresence>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.68, ease: [0.22, 0.61, 0.36, 1] }}
        className="flex flex-1 flex-col items-center justify-center gap-10 py-16 text-center"
      >
        <div className="flex flex-col items-center gap-4">
          <StatusLabel tone={paused ? 'warning' : 'live'} pulse={!paused}>
            {paused ? 'Queue paused' : 'In the queue'}
          </StatusLabel>
          <h1 className="max-w-3xl font-display text-display-sm sm:text-display-md">{event.name}</h1>
          <p className="text-sm text-muted">{event.venue}</p>
        </div>

        <PositionNumber ahead={queue.ahead} progress={progress} admitted={queue.hasPass} />

        <p aria-live="polite" className="max-w-reading text-balance text-sm leading-relaxed text-muted-foreground">
          {queue.hasPass
            ? 'Opening the seat map. Your seats are held while you choose.'
            : paused
              ? 'The sale is paused for a moment. Nobody behind you can get ahead, so you can leave this tab open.'
              : 'You are through as soon as the people in front of you are done. Refreshing will not cost you your place.'}
        </p>
      </motion.div>

      {/* The three numbers, on one rule. No tiles. */}
      <dl className="grid grid-cols-3 border-t">
        <Stat label="Your number" value={joinNumber.toLocaleString()} />
        <Stat
          label="Estimated wait"
          value={queue.hasPass ? 'None' : paused ? 'Paused' : formatWait(waitSeconds)}
          className="border-l"
        />
        <Stat
          label="In line"
          value={Math.max(0, queue.joined - queue.admitted).toLocaleString()}
          className="border-l"
        />
      </dl>

      <p className="mt-6 text-center text-xs text-faint">
        {queue.admitPerSec.toLocaleString()} people are let in every second, in the order they joined.
      </p>
    </div>
  );
}

function Stat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={`flex flex-col items-center gap-3 py-7 ${className ?? ''}`}>
      <dt className="label">{label}</dt>
      <dd data-numeral className="font-display text-xl font-light sm:text-2xl">
        {value}
      </dd>
    </div>
  );
}
