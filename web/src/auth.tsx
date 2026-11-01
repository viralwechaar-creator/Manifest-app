import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api';

export interface Me {
  user: { id: string; loginId: string; displayName: string; mustChangePassword: boolean; mfaEnabled: boolean };
  roles: string[];
  permissions: string[];
}
interface Ctx { me: Me | null; loading: boolean; refresh: () => Promise<void>; signOut: () => Promise<void>; can: (p: string) => boolean; }

const AuthCtx = createContext<Ctx>(null as any);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try { setMe(await api<Me>('/auth/me')); } catch { setMe(null); } finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  const signOut = useCallback(async () => { await api('/auth/logout', { method: 'POST' }).catch(() => {}); setMe(null); }, []);
  const can = useCallback((p: string) => !!me?.permissions.includes(p), [me]);
  return <AuthCtx.Provider value={{ me, loading, refresh, signOut, can }}>{children}</AuthCtx.Provider>;
}

/** Parents and students have their own portal; staff accounts (even with extra roles) use the staff portal. */
export const isFamilyOnly = (roles: string[]) => roles.length > 0 && roles.every((r) => r === 'parent' || r === 'student');
export const homeFor = (roles: string[]) => (isFamilyOnly(roles) ? '/family' : '/portal');
