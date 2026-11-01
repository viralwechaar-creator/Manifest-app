import { useCallback, useEffect, useState } from 'react';

type Theme = 'light' | 'dark';
const KEY = 'portal_theme';
const read = (): Theme => (localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light');
const apply = (t: Theme) => { document.documentElement.dataset.theme = t; };

/** For a portal layout: applies the saved theme while it is on screen, and clears it again for the public site. */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(read);
  useEffect(() => { apply(theme); }, [theme]);
  useEffect(() => () => { delete document.documentElement.dataset.theme; }, []);
  const toggle = useCallback(() => setTheme((t) => { const n = t === 'dark' ? 'light' : 'dark'; localStorage.setItem(KEY, n); return n; }), []);
  return { theme, toggle };
}

/** For a button inside a portal page: flips the theme the layout has already applied. */
export function useThemeToggle() {
  const [theme, setTheme] = useState<Theme>(read);
  const toggle = useCallback(() => { const n: Theme = read() === 'dark' ? 'light' : 'dark'; localStorage.setItem(KEY, n); apply(n); setTheme(n); }, []);
  return { theme, toggle };
}
