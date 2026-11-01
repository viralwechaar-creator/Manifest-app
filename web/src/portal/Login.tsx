import { FormEvent, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { useSettings } from '../site/SiteData';
import { clearSchemaCache } from './schema';

export function Login() {
  const { me, refresh, loading } = useAuth();
  const { s } = useSettings();
  const [loginId, setLoginId] = useState(''); const [password, setPassword] = useState(''); const [otp, setOtp] = useState('');
  const [mfa, setMfa] = useState(false); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  if (!loading && me) return <Navigate to="/portal" replace />;
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      const r = await api('/auth/login', { method: 'POST', body: { loginId, password, otp: mfa ? otp : undefined } });
      if (r.mfaRequired) { setMfa(true); return; }
      clearSchemaCache(); await refresh();
    } catch (x) { setErr((x as ApiError).message); } finally { setBusy(false); }
  }
  return (
    <div className="login-shell">
      <div className="login-art grain">
        <a href="/" className="brand" style={{ color: '#fff' }}><span className="brand-mark" style={{ background: 'var(--paper)', color: 'var(--forest)' }}>{(s.school_name || 'S')[0]}</span><b style={{ fontFamily: 'var(--font-display)', fontWeight: 500 }}>{s.school_name}</b></a>
        <div><h1 style={{ fontSize: 'clamp(2rem,4vw,3.4rem)', maxWidth: '12ch' }}>Welcome back</h1><p style={{ color: '#c8d3c6', maxWidth: '34ch', marginTop: '1rem' }}>Sign in to the school portal. Staff, parents and students each see only what is theirs.</p></div>
        <a href="/" style={{ color: 'var(--olive)' }}>← Back to the website</a>
      </div>
      <div className="login-form">
        <form onSubmit={submit}>
          <h2 style={{ fontSize: '2rem', marginBottom: '1.4rem' }}>{mfa ? 'Verification code' : 'Sign in'}</h2>
          {err && <div className="notice error" role="alert" style={{ marginBottom: '1rem' }}>{err}</div>}
          {!mfa ? <>
            <div className="field"><label htmlFor="li">Login ID</label><input id="li" type="text" autoComplete="username" required value={loginId} onChange={(e) => setLoginId(e.target.value)} autoCapitalize="none" /></div>
            <div className="field"><label htmlFor="pw">Password</label><input id="pw" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></div>
          </> : <div className="field"><label htmlFor="otp">6-digit code from your authenticator app</label><input id="otp" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required autoFocus value={otp} onChange={(e) => setOtp(e.target.value)} /></div>}
          <button className="btn" style={{ width: '100%' }} disabled={busy}>{busy ? 'Signing in…' : mfa ? 'Verify' : 'Sign in'}</button>
          <p className="muted" style={{ fontSize: '.82rem', marginTop: '1rem' }}>Forgotten your password? Ask the school office to reset it.</p>
        </form>
      </div>
    </div>
  );
}
