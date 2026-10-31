import { create } from 'zustand';

export type SessionUser = { id: string; email: string; role: 'BUYER' | 'ADMIN' };

const STORAGE_KEY = 'fq:session';

type StoredSession = { token: string; user: SessionUser };

function readStoredSession(): StoredSession | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}

type AuthState = {
  token: string | null;
  user: SessionUser | null;
  setSession: (session: StoredSession) => void;
  clear: () => void;
};

const stored = readStoredSession();

export const useAuthStore = create<AuthState>((set) => ({
  token: stored?.token ?? null,
  user: stored?.user ?? null,
  setSession: ({ token, user }) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ token, user }));
    } catch {
      // Not fatal: the session just will not survive a reload.
    }
    set({ token, user });
  },
  clear: () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    set({ token: null, user: null });
  },
}));
