import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { QRCodeSVG } from 'qrcode.react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { SuccessRule } from '@/components/ui/confetti';
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
      <div className="mx-auto max-w-page px-gutter lg:px-gutter-lg">
        <EmptyState
          tone="danger"
          title="Ticket not found"
          description="That order does not exist, or it is not yours."
          action={
            <Button asChild variant="subtle" size="sm">
              <Link to="/">Back to events</Link>
            </Button>
          }
        />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="mx-auto flex min-h-[70svh] max-w-reading flex-col justify-center gap-8 px-gutter">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  return (
    <div className="relative mx-auto flex min-h-[calc(100svh-var(--spacing-nav,4.5rem))] max-w-reading flex-col justify-center px-gutter py-20">
      <SuccessRule />

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.68, ease: [0.22, 0.61, 0.36, 1] }}
        className="flex flex-col gap-10"
      >
        <div className="flex flex-col gap-4">
          <Label tone="live">
            {order.tickets.length === 1 ? 'Seat is yours' : 'Seats are yours'}
          </Label>
          <h1 className="font-display text-display-sm">{order.event.name}</h1>
          <p className="text-sm text-muted-foreground">
            {order.event.venue} · {formatDate(order.event.startsAt)} ·{' '}
            {formatTime(order.event.startsAt)}
          </p>
        </div>

        <ul className="flex flex-col border-t">
          {order.tickets.map((ticket) => (
            <li
              key={ticket.id}
              className="flex items-center justify-between gap-4 border-b py-4 text-sm"
            >
              <span>
                {ticket.seat.section} · Row {ticket.seat.row} · Seat {ticket.seat.number}
              </span>
              <span data-numeral className="text-muted-foreground">
                {formatPrice(ticket.seat.price)}
              </span>
            </li>
          ))}
        </ul>

        {/* The one place the design turns light: the code has to scan. */}
        <div className="flex items-end justify-between gap-8">
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <Label>Order</Label>
              <span className="font-mono text-xs text-muted-foreground">{order.id}</span>
            </div>
            <div className="flex flex-col gap-2">
              <Label>Total paid</Label>
              <span data-numeral className="font-display text-2xl font-light">
                {formatPrice(order.total)}
              </span>
            </div>
          </div>
          <div className="bg-white p-3">
            <QRCodeSVG value={`fairqueue:order:${order.id}`} size={96} level="M" />
          </div>
        </div>

        <div className="flex flex-col gap-6 border-t pt-8">
          <p className="text-xs text-faint">
            Show this code at the door. Payment was simulated and no real ticket was issued.
          </p>
          <Button asChild variant="subtle" size="md" className="self-start">
            <Link to="/">Back to events</Link>
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
