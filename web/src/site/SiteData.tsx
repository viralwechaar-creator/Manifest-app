import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { api, qs } from '../api';

export type Settings = Record<string, string>;
const Ctx = createContext<{ s: Settings; ready: boolean }>({ s: {}, ready: false });
export const useSettings = () => useContext(Ctx);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [s, setS] = useState<Settings>({});
  const [ready, setReady] = useState(false);
  useEffect(() => { api<Settings>('/public/settings').then(setS).catch(() => {}).finally(() => setReady(true)); }, []);
  useEffect(() => { if (s.school_name) document.title = s.school_name; }, [s.school_name]);
  return <Ctx.Provider value={{ s, ready }}>{children}</Ctx.Provider>;
}

/** Loads public content; returns {data, loading, error}. */
export function usePublic<T = any>(path: string, params: Record<string, string | number | undefined> = {}) {
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string | null }>({ data: null, loading: true, error: null });
  const key = path + qs(params);
  useEffect(() => {
    let live = true;
    setState((x) => ({ ...x, loading: true, error: null }));
    api<T>('/public/' + path + qs(params))
      .then((data) => live && setState({ data, loading: false, error: null }))
      .catch((e) => live && setState({ data: null, loading: false, error: e.message }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}
