/** The picture used on the home page and sign-in screen until the school uploads its own in Site settings. */
export const DEFAULT_HERO = '/hero.jpg';
/** The illustration on the sign-in screen (light picture: dark text over its white top). */
export const LOGIN_ART = '/login-art.jpg';
export const fmtDate = (v?: string | null, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) =>
  v ? new Intl.DateTimeFormat('en-IN', opts).format(new Date(v)) : '';
export const fmtTime = (v?: string | null) => (v ? new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit' }).format(new Date(v)) : '');
export const toLocalInput = (v?: string | null) => {
  if (!v) return '';
  const d = new Date(v); const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
export const parseStats = (s?: string) =>
  (s ?? '').split('\n').map((l) => l.split('|').map((x) => x.trim())).filter((p) => p.length === 2 && p[0] && p[1] && p[1] !== '0');
