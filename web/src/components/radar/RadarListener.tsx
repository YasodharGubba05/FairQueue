import { useEffect } from 'react';
import { getSocket } from '@/lib/socket';
import { currentAccessToken, useAuthStore } from '@/store/auth';
import { useNotificationStore } from '@/store/notifications';
import type { NotificationPush, NotificationsResponse } from '@/lib/types';
import { api } from '@/lib/api';
import { toast } from '@/store/toast';
import { formatEventName } from '@/lib/utils';

const WORDING = {
  SALE_OPENED: 'Tickets are on sale now',
  SALE_OPENING_SOON: 'The sale opens shortly',
  INVENTORY_RETURNED: 'Seats are available again',
} as const;

/**
 * Keeps this person's notification room joined, and reacts to arrivals.
 *
 * The room is authenticated, so it has to be re-joined whenever the access
 * token changes — which it does every ten minutes on refresh — and again after
 * a reconnect, because a new connection is in no rooms at all.
 *
 * A push carries no id of its own, so rather than inventing one the list is
 * re-read from the server. That keeps a single source for the unread count,
 * which two tabs would otherwise disagree about.
 */
export function RadarListener() {
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);
  const { set, clear } = useNotificationStore();

  useEffect(() => {
    if (!user || !accessToken) {
      clear();
      return;
    }

    const socket = getSocket();

    const join = () => {
      const token = currentAccessToken();
      if (token) socket.emit('user:subscribe', token);
    };
    join();
    // A reconnect starts in no rooms, so rejoin.
    socket.on('connect', join);

    const onNotification = (push: NotificationPush) => {
      const line = WORDING[push.kind] ?? 'Something happened';
      toast.success(formatEventName(push.event.name), line);

      // Re-read rather than synthesising a row: the server owns the ids and
      // the unread count.
      api
        .get<NotificationsResponse>('/api/notifications')
        .then((res) => set(res.notifications, res.unread))
        .catch(() => {});
    };

    socket.on('notification', onNotification);

    return () => {
      socket.off('connect', join);
      socket.off('notification', onNotification);
      socket.emit('user:unsubscribe');
    };
  }, [user, accessToken, set, clear]);

  return null;
}
