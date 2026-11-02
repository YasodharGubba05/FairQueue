import { create } from 'zustand';
import type { AppNotification } from '@/lib/types';

/**
 * What this person has been told.
 *
 * Held in memory and refilled from the server on sign-in, like the session
 * itself. A notification is already persisted in Postgres, so there is nothing
 * to gain from a second copy in browser storage — and the unread count has to
 * come from the server anyway, or two tabs would disagree.
 */
type NotificationState = {
  items: AppNotification[];
  unread: number;
  set: (items: AppNotification[], unread: number) => void;
  /** A live push: prepend it and bump the count. */
  prepend: (item: AppNotification) => void;
  markAllRead: () => void;
  clear: () => void;
};

export const useNotificationStore = create<NotificationState>((set) => ({
  items: [],
  unread: 0,
  set: (items, unread) => set({ items, unread }),
  prepend: (item) =>
    set((state) => ({
      // Guard against a push arriving twice, which a reconnect can cause.
      items: state.items.some((i) => i.id === item.id)
        ? state.items
        : [item, ...state.items].slice(0, 50),
      unread: state.items.some((i) => i.id === item.id) ? state.unread : state.unread + 1,
    })),
  markAllRead: () =>
    set((state) => ({
      items: state.items.map((i) => ({ ...i, readAt: i.readAt ?? new Date().toISOString() })),
      unread: 0,
    })),
  clear: () => set({ items: [], unread: 0 }),
}));
