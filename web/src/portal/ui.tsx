import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, qs } from '../api';
import { fmtDate } from '../lib';

export const dt = (v?: string | null) => (v ? fmtDate(v, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

export function Pager({ page, total, size, onPage }: { page: number; total: number; size: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / size));
  return <div className="pager"><span>{total} record{total === 1 ? '' : 's'}</span><button className="btn ghost sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button><span>Page {page} of {pages}</span><button className="btn ghost sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button></div>;
}

/** Loads a paged list with debounced search and filters. */
export function usePaged<T = any>(path: string, params: Record<string, string | number | undefined>) {
  const [rows, setRows] = useState<T[]>([]); const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true); const [err, setErr] = useState('');
  const key = path + qs(params);
  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try { const r = await api(path + qs(params)); setRows(r.rows); setTotal(r.total); } catch (e) { setErr((e as ApiError).message); } finally { setLoading(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);
  return { rows, total, loading, err, reload: load };
}

/**
 * Loads data from the API. When `keep` is true (use it for search boxes), the previous results stay on screen while
 * new ones load, so the screen (and the box being typed in) is never replaced by "Loading…". Late answers from
 * older requests are ignored.
 */
export function useApi<T = any>(path: string | null, deps: unknown[] = [], keep = false) {
  const [data, setData] = useState<T | null>(null); const [err, setErr] = useState('');
  const seq = useRef(0);
  const load = useCallback(() => {
    if (!path) return;
    const id = ++seq.current;
    api<T>(path).then((d) => { if (id === seq.current) setData(d); }).catch((e) => { if (id === seq.current) setErr(e.message); });
  }, [path]); // eslint-disable-line
  useEffect(() => { if (!keep || !path) setData(null); setErr(''); load(); }, [load, ...deps]); // eslint-disable-line
  return { data, err, reload: load };
}

export function Select({ label, value, onChange, options, id, blank = 'All', required }: { label?: string; value: any; onChange: (v: string) => void; options: { value: any; label: string }[]; id?: string; blank?: string | null; required?: boolean }) {
  return (
    <div className="field" style={label ? undefined : { margin: 0 }}>
      {label && <label htmlFor={id}>{label}{required && ' *'}</label>}
      <select id={id} className="input" aria-label={label ?? blank ?? 'Select'} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        {blank !== null && <option value="">{blank}</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}
