import { FormEvent, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import { homeFor, useAuth } from '../auth';
import { LOGIN_ART } from '../lib';
import { useSettings } from '../site/SiteData';
import { clearSchemaCache } from './schema';
import { LangSwitch, t } from '../i18n';
import { BrandMark } from '../components/BrandMark';

export function Login() {
  const { me, refresh, loading } = useAuth();
  const { s } = useSettings();
  const [loginId, setLoginId] = useState(''); const [password, setPassword] = useState(''); const [otp, setOtp] = useState('');
  const [sheet, setSheet] = useState(false);
  const [mfa, setMfa] = useState(false); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!sheet) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setSheet(false);
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [sheet]);
  if (!loading && me) return <Navigate to={homeFor(me.roles)} replace />;
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      const r = await api('/auth/login', { method: 'POST', body: { loginId, password, otp: mfa ? otp : undefined } });
      if (r.mfaRequired) { setMfa(true); return; }
      clearSchemaCache(); await refresh();
    } catch (x) { setErr((x as ApiError).message); } finally { setBusy(false); }
  }
  return (
    <div className={'auth-page' + (sheet ? ' sheet-open' : '')}>
      <div className="auth-card">
        <aside className="auth-visual light">
          <img src={LOGIN_ART} alt="" />
          <div className="auth-shade" aria-hidden />
          <a href="/" className="auth-brand"><BrandMark logoUrl={s.logo_url} /><b>{s.school_name}</b></a>
          <div className="auth-caption">
            <h1>{t('Welcome back')}</h1>
            <p>{s.tagline || 'Everyone sees only what is theirs.'}</p>
            <div className="glass-row">{[['01', t('Staff')], ['02', t('Parents')], ['03', t('Students')]].map(([n, l], i) => <div key={n} className={'glass' + (i === 0 ? ' on' : '')}><span>{n}</span>{l}</div>)}</div>
          </div>
          <button type="button" className="auth-open" onClick={() => setSheet(true)} aria-haspopup="dialog">{t('Sign in')}</button>
        </aside>
        <div className="auth-scrim" onClick={() => setSheet(false)} aria-hidden />
        <main className="auth-form" role="dialog" aria-label="Sign in" aria-modal={sheet || undefined}>
          <button type="button" className="auth-grab" onClick={() => setSheet(false)} aria-label="Close sign in"><span /></button>
          <form onSubmit={submit}>
            <h2>{mfa ? t('Verification code') : t('Sign in to your account')}</h2>
            <p className="sub">{mfa ? 'Enter the 6-digit code from your authenticator app.' : t('Use the login ID given to you by the school.')}</p>
            {err && <div className="notice error" role="alert" style={{ marginBottom: '1rem' }}>{err}</div>}
            {!mfa ? <>
              <div className="field"><label htmlFor="li">{t('Login ID')}</label><input id="li" type="text" autoComplete="username" required autoFocus={sheet} value={loginId} onChange={(e) => setLoginId(e.target.value)} autoCapitalize="none" placeholder="e.g. name@school.org" /></div>
              <div className="field"><label htmlFor="pw">{t('Password')}</label><input id="pw" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Your password" /></div>
            </> : <div className="field"><label htmlFor="otp">Code</label><input id="otp" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required autoFocus value={otp} onChange={(e) => setOtp(e.target.value)} placeholder="123456" /></div>}
            <button className="auth-btn" disabled={busy}>{busy ? t('Signing in…') : mfa ? t('Verify') : t('Sign in')}</button>
            <p className="hint">{t('Forgotten your password? Ask the school office to reset it.')}</p>
            <p className="hint"><a href="/">{t('← Back to the website')}</a></p><p className="hint"><LangSwitch className="btn ghost sm" /></p>
          </form>
        </main>
      </div>
    </div>
  );
}
