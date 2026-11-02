import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import type { AppNotification, NotificationKind, NotificationsResponse } from '@/lib/types';
import { useAuthStore } from '@/store/auth';
import { useNotificationStore } from '@/store/notifications';
import { formatEventName } from '@/lib/utils';

/** What each kind of notification actually says to a person. */
const WORDING: Record<NotificationKind, { label: string; line: string }> = {
  SALE_OPENED: { label: 'On sale now', line: 'Tickets are on sale' },
  SALE_OPENING_SOON: { label: 'Opening soon', line: 'The sale opens shortly' },
  INVENTORY_RETURNED: { label: 'Seats back', line: 'Seats are available again' },
};

export function NotificationBell() {
  const user = useAuthStore((s) => s.user);
  const { items, unread, set, markAllRead } = useNotificationStore();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Load once per sign-in. Live arrivals come down the socket, so this does
  // not poll.
  useEffect(() => {
    if (!user) return;
    api
      .get<NotificationsResponse>('/api/notifications')
      .then((res) => set(res.notifications, res.unread))
      .catch(() => {});
  }, [user, set]);

  useEffect(() => {
    if (!open) return;
    const onAway = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onAway);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onAway);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!user) return null;

  async function toggle() {
    const next = !open;
    setOpen(next);
    // Opening the list is reading it.
    if (next && unread > 0) {
      markAllRead();
      await api.post('/api/notifications/read', {}).catch(() => {});
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <Button
        variant="ghost"
        size="icon"
        onClick={() => void toggle()}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
      >
        <Bell aria-hidden />
        {unread > 0 ? (
          <span
            aria-hidden
            className="absolute right-1.5 top-1.5 size-1.5 rounded-pill bg-success"
          />
        ) : null}
      </Button>

      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.22, ease: [0.22, 0.61, 0.36, 1] }}
            className="absolute right-0 top-full z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded bg-surface shadow-lift-hover"
          >
            <div className="border-b px-5 py-4">
              <Label>Radar</Label>
            </div>

            {items.length === 0 ? (
              <p className="px-5 py-6 text-sm leading-relaxed text-muted">
                Follow an event and you will hear from us the moment its sale opens.
              </p>
            ) : (
              <ul className="scroll-slim max-h-96 overflow-y-auto">
                {items.map((n) => (
                  <NotificationRow key={n.id} notification={n} onNavigate={() => setOpen(false)} />
                ))}
              </ul>
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function NotificationRow({
  notification: n,
  onNavigate,
}: {
  notification: AppNotification;
  onNavigate: () => void;
}) {
  const wording = WORDING[n.kind];
  const live = n.event.status === 'LIVE' || n.event.status === 'PAUSED';

  return (
    <li className="border-b last:border-b-0">
      <Link
        to={live ? `/events/${n.event.id}/queue` : '/'}
        onClick={onNavigate}
        className="flex flex-col gap-1.5 px-5 py-4 transition-colors duration-[var(--dur-fast)] hover:bg-surface-raised"
      >
        <span className="flex items-center gap-2">
          {!n.readAt ? (
            <span aria-hidden className="size-1.5 shrink-0 rounded-pill bg-success" />
          ) : null}
          <Label tone={n.kind === 'SALE_OPENED' ? 'live' : 'muted'}>{wording.label}</Label>
        </span>
        <span className="text-sm leading-snug">{formatEventName(n.event.name)}</span>
        <span className="text-xs text-faint">
          {wording.line} · {n.event.venue}
        </span>
      </Link>
    </li>
  );
}
