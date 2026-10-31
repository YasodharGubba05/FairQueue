import { create } from 'zustand';

export type SessionUser = { id: string; email: string; role: 'BUYER' | 'ADMIN' };

/**
 * The session, held in memory and nowhere else.
 *
 * Nothing here is written to localStorage or sessionStorage. That is the whole
 * point: a token in storage survives a tab close, which sounds convenient
 * until you notice it also survives an XSS. The access token lives as long as
 * this JavaScript context and no longer.
 *
 * What makes that bearable is the refresh cookie, which the browser holds and
 * script cannot read. On load the app asks the server to mint a new access
 * token from it, so a refresh of the page restores the session without the
 * token ever having been persisted.
 */
type AuthState = {
  accessToken: string | null;
  user: SessionUser | null;
  /** True until the first restore attempt finishes, so routes can wait. */
  restoring: boolean;
  setSession: (session: { accessToken: string; user: SessionUser }) => void;
  clear: () => void;
  setRestoring: (restoring: boolean) => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  restoring: true,
  setSession: ({ accessToken, user }) => set({ accessToken, user, restoring: false }),
  clear: () => set({ accessToken: null, user: null, restoring: false }),
  setRestoring: (restoring) => set({ restoring }),
}));

/**
 * Read the token outside React.
 *
 * The api client needs it on every request and must not re-render anything to
 * get it, so it reads straight from the store rather than through a hook.
 */
export function currentAccessToken(): string | null {
  return useAuthStore.getState().accessToken;
}
