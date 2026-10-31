import { useAuthStore, currentAccessToken, type SessionUser } from '@/store/auth';

/** A failed response, carrying the status so callers can branch on 401/409. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type RefreshResponse = { accessToken: string; expiresIn: number; user: SessionUser };

/**
 * One refresh at a time.
 *
 * A page typically fires several requests at once. If the access token has
 * just expired they all get a 401 together, and without this they would all
 * try to refresh — which, with rotation, means the first one succeeds and the
 * rest present a token that has just been spent. That looks exactly like
 * token theft to the server, and it would revoke the whole family and sign
 * the user out. So the first caller refreshes and everyone else waits on it.
 */
let refreshInFlight: Promise<string | null> | null = null;

export async function refreshSession(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        // Sends the HttpOnly refresh cookie.
        credentials: 'include',
      });
      if (!res.ok) {
        useAuthStore.getState().clear();
        return null;
      }
      const body = (await res.json()) as RefreshResponse;
      useAuthStore.getState().setSession({ accessToken: body.accessToken, user: body.user });
      scheduleRefresh(body.expiresIn);
      return body.accessToken;
    } catch {
      useAuthStore.getState().clear();
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

/**
 * Refresh a little before the token expires, so a request rarely has to fail
 * first. The 401 path below still exists, because a laptop that was asleep
 * comes back with every timer long overdue.
 */
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleRefresh(expiresInSeconds: number) {
  if (refreshTimer) clearTimeout(refreshTimer);
  const lead = Math.max(30, Math.floor(expiresInSeconds * 0.2));
  refreshTimer = setTimeout(() => void refreshSession(), (expiresInSeconds - lead) * 1000);
}

export function stopRefreshTimer() {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = null;
}

async function send(method: string, path: string, body: unknown, token: string | null) {
  return fetch(path, {
    method,
    credentials: 'include',
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res = await send(method, path, body, currentAccessToken());

  // An expired access token is an ordinary event every ten minutes, not an
  // error. Refresh once and replay the request; if that fails, the session is
  // genuinely over.
  if (res.status === 401 && !path.startsWith('/api/auth/')) {
    const token = await refreshSession();
    if (token) res = await send(method, path, body, token);
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;

  if (!res.ok) {
    const record = data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
    throw new ApiError(
      res.status,
      record && 'error' in record ? String(record.error) : `Request failed (${res.status})`,
      record && typeof record.code === 'string' ? record.code : undefined,
    );
  }

  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  del: <T>(path: string, body?: unknown) => request<T>('DELETE', path, body),
};

export async function logout(): Promise<void> {
  stopRefreshTimer();
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  } finally {
    // The local session is cleared whatever the server said: a sign-out that
    // appears to fail is worse than one the server already forgot about.
    useAuthStore.getState().clear();
  }
}
