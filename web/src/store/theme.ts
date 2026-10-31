import { create } from 'zustand';

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'fq:theme';

function readStoredTheme(): Theme {
  if (typeof localStorage === 'undefined') return 'dark';
  return localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark';
}

/** Dark is the default, so only the light theme sets an attribute. */
function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return;
  if (theme === 'light') document.documentElement.setAttribute('data-theme', 'light');
  else document.documentElement.removeAttribute('data-theme');
}

type ThemeState = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggle: () => void;
};

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: readStoredTheme(),
  setTheme: (theme) => {
    applyTheme(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Private browsing can refuse storage; the theme still applies for this visit.
    }
    set({ theme });
  },
  toggle: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),
}));

/** Applied before React renders so there is no flash of the wrong theme. */
export function initTheme() {
  applyTheme(readStoredTheme());
}
