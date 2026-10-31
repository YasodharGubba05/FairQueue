import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { QRCodeSVG } from 'qrcode.react';
import { CalendarDays, Check, MapPin, TicketX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Confetti } from '@/components/ui/confetti';
import { api } from '@/lib/api';
import type { OrderDetail } from '@/lib/types';
import { useAuthStore } from '@/store/auth';
import { formatDate, formatPrice, formatTime } from '@/lib/utils';

export default function TicketPage() {
  const { orderId = '' } = useParams();
  const navigate = useNavigate();
  const token = useAuthStore((s) => s.token);

  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!token) navigate(`/login?next=/orders/${orderId}`, { replace: true });
  }, [token, orderId, navigate]);

  useEffect(() => {
    if (!token || !orderId) return;
    api
      .get<{ order: OrderDetail }>(`/api/orders/${orderId}`)
      .then((res) => setOrder(res.order))
      .catch(() => setMissing(true));
  }, [token, orderId]);

  if (missing) {
    return (
      <div className="mx-auto max-w-page px-gutter py-16 lg:px-gutter-lg">
        <EmptyState
          icon={TicketX}
          tone="danger"
          title="Ticket not found"
          description="That order does not exist, or it is not yours."
          action={
            <Button asChild variant="secondary" size="sm">
              <Link to="/">Back to events</Link>
            </Button>
          }
        />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="mx-auto max-w-md px-gutter py-12">
        <Skeleton className="h-[460px] w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="relative mx-auto max-w-md px-gutter py-10 sm:py-14">
      <Confetti />

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="flex flex-col items-center"
      >
        <span className="mb-4 flex items-center gap-2 rounded-full border border-success/30 bg-success/10 px-3 py-1 text-sm text-success">
          <Check className="size-4" aria-hidden />
          {order.tickets.length === 1 ? 'Seat is yours' : 'Seats are yours'}
        </span>

        {/* Ticket stub: one card, notched in the middle, torn edge at the fold. */}
        <div className="w-full overflow-hidden rounded-xl border border-border bg-surface shadow-raised">
          <div className="bg-gradient-to-br from-accent to-highlight px-5 py-6 text-accent-foreground">
            <p className="text-xs uppercase tracking-[0.2em] opacity-80">Admit {order.tickets.length}</p>
            <h1 className="mt-1 font-display text-2xl font-semibold leading-tight">
              {order.event.name}
            </h1>
          </div>

          <div className="flex flex-col gap-3 px-5 py-5">
            <p className="flex items-center gap-2 text-sm text-muted">
              <MapPin className="size-4 shrink-0" aria-hidden />
              {order.event.venue}
            </p>
            <p className="flex items-center gap-2 text-sm text-muted">
              <CalendarDays className="size-4 shrink-0" aria-hidden />
              {formatDate(order.event.startsAt)} · {formatTime(order.event.startsAt)}
            </p>

            <ul className="mt-1 flex flex-col divide-y divide-border rounded-lg border border-border">
              {order.tickets.map((ticket) => (
                <li
                  key={ticket.id}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                >
                  <span className="font-medium">
                    {ticket.seat.section} · Row {ticket.seat.row} · Seat {ticket.seat.number}
                  </span>
                  <span className="tabular-nums text-muted">{formatPrice(ticket.seat.price)}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* The tear line, with the notches a real stub has. */}
          <div className="relative border-t border-dashed border-border">
            <span className="absolute -left-2.5 -top-2.5 size-5 rounded-full bg-background" aria-hidden />
            <span className="absolute -right-2.5 -top-2.5 size-5 rounded-full bg-background" aria-hidden />
          </div>

          <div className="flex items-center gap-4 px-5 py-5">
            <div className="rounded-lg bg-white p-2">
              <QRCodeSVG value={`fairqueue:order:${order.id}`} size={92} level="M" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs uppercase tracking-wide text-muted">Order</p>
              <p className="truncate font-mono text-xs">{order.id}</p>
              <p className="mt-2 text-xs uppercase tracking-wide text-muted">Total paid</p>
              <p className="font-display text-lg font-semibold tabular-nums">
                {formatPrice(order.total)}
              </p>
            </div>
          </div>
        </div>

        <p className="mt-5 text-center text-sm text-muted">
          Show this code at the door. It is also in your order history.
        </p>

        <Button asChild variant="secondary" className="mt-5">
          <Link to="/">Back to events</Link>
        </Button>
      </motion.div>
    </div>
  );
}
