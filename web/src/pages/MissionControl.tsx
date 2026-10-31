import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Area, AreaChart, ResponsiveContainer, YAxis } from 'recharts';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusLabel } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { getSocket, subscribeToEvent } from '@/lib/socket';
import type { EventSummary, StatsTick } from '@/lib/types';
import { cn } from '@/lib/utils';

/** How much history the sparklines keep: two minutes at one reading a second. */
const HISTORY = 120;

/**
 * The demo centrepiece. Four big numbers across the top, the rates underneath,
 * and the one number that justifies the whole project — oversold seats, which
 * is read from Postgres rather than Redis, because asking the lock whether it
 * worked is asking the accused.
 */
export default function MissionControl() {
  const [events, setEvents] = useState<EventSummary[] | null>(null);
  const [eventId, setEventId] = useState<string | null>(null);
  const [stats, setStats] = useState<StatsTick | null>(null);
  const [online, setOnline] = useState(true);
  const history = useRef<StatsTick[]>([]);
  const [, forceRender] = useState(0);

  useEffect(() => {
    api
      .get<{ events: EventSummary[] }>('/api/events')
      .then((res) => {
        setEvents(res.events);
        const live = res.events.find((e) => e.status === 'LIVE') ?? res.events[0];
        if (live) setEventId(live.id);
      })
      .catch(() => setEvents([]));
  }, []);

  // Seed from the http endpoint so the page has numbers before the first tick.
  useEffect(() => {
    if (!eventId) return;
    history.current = [];
    api
      .get<StatsTick>(`/api/events/${eventId}/stats`)
      .then((s) => setStats({ ...s, type: 'stats' }))
      .catch(() => {});
  }, [eventId]);

  useEffect(() => {
    if (!eventId) return;
    const socket = getSocket();
    const unsubscribe = subscribeToEvent(eventId);

    const onStats = (tick: StatsTick) => {
      if (tick.eventId !== eventId) return;
      setStats(tick);
      history.current = [...history.current, tick].slice(-HISTORY);
      forceRender((n) => n + 1);
    };
    const onConnect = () => setOnline(true);
    const onDisconnect = () => setOnline(false);

    socket.on('stats:tick', onStats);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    setOnline(socket.connected);

    return () => {
      socket.off('stats:tick', onStats);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      unsubscribe();
    };
  }, [eventId]);

  const series = useMemo(
    () => history.current.map((s) => ({ queue: s.inQueue, buys: s.purchaseRate, pods: s.livePods })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [history.current.length],
  );

  if (events !== null && events.length === 0) {
    return (
      <div className="mx-auto max-w-page px-gutter lg:px-gutter-lg">
        <EmptyState
          tone="danger"
          title="No events to watch"
          description="Mission Control reads a live sale. Seed the database and come back."
          action={
            <Button asChild variant="subtle" size="sm">
              <Link to="/">Back to events</Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-page px-gutter pb-24 pt-8 lg:px-gutter-lg">
      <div className="flex flex-wrap items-end justify-between gap-6 border-b pb-8">
        <div className="flex flex-col gap-3">
          <StatusLabel tone={online ? 'live' : 'warning'} pulse={online}>
            {online ? 'Live' : 'Reconnecting'}
          </StatusLabel>
          <h1 className="font-display text-display-sm sm:text-display-md">Mission Control</h1>
        </div>

        {events && events.length > 1 ? (
          <div className="flex flex-wrap gap-5">
            {events.map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => setEventId(e.id)}
                className={cn(
                  'rounded-sm text-sm transition-colors duration-[var(--dur-fast)]',
                  e.id === eventId ? 'text-foreground' : 'text-muted hover:text-foreground',
                )}
              >
                {e.name}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {!stats ? (
        <div className="grid gap-px border-t sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-36" />
          ))}
        </div>
      ) : (
        <>
          {/* The headline four. */}
          <dl className="grid border-b sm:grid-cols-2 lg:grid-cols-4">
            <Figure label="In queue" value={stats.inQueue} series={series} dataKey="queue" />
            <Figure
              label="Purchases"
              value={stats.purchaseRate}
              suffix="/s"
              decimals={1}
              series={series}
              dataKey="buys"
              className="sm:border-l"
            />
            <Figure label="Seats left" value={stats.seatsLeft} className="lg:border-l" />
            <Figure
              label="Oversold"
              value={stats.oversold}
              tone={stats.oversold === 0 ? 'good' : 'bad'}
              note={stats.oversold === 0 ? 'Counted in Postgres' : 'Seats sold more than once'}
              className="sm:border-l"
            />
          </dl>

          {/* The supporting row. */}
          <dl className="grid border-b sm:grid-cols-2 lg:grid-cols-4">
            <Figure label="Api pods" value={stats.livePods} series={series} dataKey="pods" small />
            <Figure
              label="Admitted"
              value={stats.admittedRate}
              suffix="/s"
              decimals={1}
              small
              className="sm:border-l"
            />
            <Figure label="Blocked" value={stats.blocked} small className="lg:border-l" />
            <Figure
              label="Queue skips"
              value={stats.noPass}
              note="Holds and buys with no pass"
              small
              className="sm:border-l"
            />
          </dl>

          <div className="grid gap-x-16 gap-y-8 py-10 sm:grid-cols-2 lg:grid-cols-4">
            <Detail label="Joined the line" value={stats.joined.toLocaleString()} />
            <Detail label="Let in so far" value={stats.admitted.toLocaleString()} />
            <Detail label="Tickets sold" value={stats.ticketsSold.toLocaleString()} />
            <Detail label="Admitting at" value={`${stats.admitPerSec}/s`} />
          </div>
        </>
      )}
    </div>
  );
}

function Figure({
  label,
  value,
  suffix,
  decimals = 0,
  tone,
  note,
  series,
  dataKey,
  small,
  className,
}: {
  label: string;
  value: number;
  suffix?: string;
  decimals?: number;
  tone?: 'good' | 'bad';
  note?: string;
  series?: { queue: number; buys: number; pods: number }[];
  dataKey?: 'queue' | 'buys' | 'pods';
  small?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-4 border-t py-8 pr-8 transition-colors duration-[var(--dur)] sm:pl-8 sm:first:pl-0',
        'hover:bg-[hsl(var(--foreground)/0.025)]',
        className,
      )}
    >
      <dt className="label">{label}</dt>
      <dd
        data-numeral
        className={cn(
          'font-display font-light leading-none tracking-tight',
          small ? 'text-3xl' : 'text-5xl',
          tone === 'good' && 'text-success',
          tone === 'bad' && 'text-danger',
        )}
      >
        <motion.span
          key={Math.round((value ?? 0) * 10)}
          initial={{ opacity: 0.5 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.22 }}
        >
          {(value ?? 0).toLocaleString(undefined, {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals,
          })}
        </motion.span>
        {suffix ? <span className="text-base text-faint">{suffix}</span> : null}
      </dd>

      {series && dataKey && series.length > 1 ? (
        <div className="h-8 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
              <YAxis hide domain={[0, 'dataMax']} />
              <Area
                type="monotone"
                dataKey={dataKey}
                stroke="hsl(var(--foreground))"
                strokeWidth={1}
                fill="hsl(var(--foreground))"
                fillOpacity={0.045}
                isAnimationActive={false}
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : null}

      {note ? <p className="text-xs text-faint">{note}</p> : null}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b pb-3 sm:flex-col sm:items-start sm:gap-2 sm:border-b-0 sm:pb-0">
      <dt className="label">{label}</dt>
      <dd data-numeral className="font-display text-lg font-light">
        {value}
      </dd>
    </div>
  );
}
