import { create } from 'zustand';

/**
 * The join number is the only thing the browser has to remember: with it plus
 * the broadcast "admitted" number it can work out its own position. Keeping it
 * in localStorage means a refresh or a closed tab never costs you your place.
 */
const STORAGE_KEY = 'fq:queue';

type Numbers = Record<string, number>;

function read(): Numbers {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Numbers) : {};
  } catch {
    return {};
  }
}

type QueueStore = {
  numbers: Numbers;
  setNumber: (eventId: string, joinNumber: number) => void;
  clearNumber: (eventId: string) => void;
};

export const useQueueStore = create<QueueStore>((set, get) => ({
  numbers: read(),
  setNumber: (eventId, joinNumber) => {
    const numbers = { ...get().numbers, [eventId]: joinNumber };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(numbers));
    } catch {
      // Not fatal: the server is still the source of truth on the next load.
    }
    set({ numbers });
  },
  clearNumber: (eventId) => {
    const numbers = { ...get().numbers };
    delete numbers[eventId];
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(numbers));
    } catch {
      // ignore
    }
    set({ numbers });
  },
}));
