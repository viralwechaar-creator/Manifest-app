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
    <div className="auth-page">
      <div className="auth-card">
        <aside className="auth-visual">
          {s.hero_image_url ? <img src={s.hero_image_url} alt="" /> : <div className="auth-glow" aria-hidden><i /></div>}
          <div className="auth-shade" aria-hidden />
          <a href="/" className="auth-brand"><span className="brand-mark" style={{ background: '#fff', color: 'var(--forest)' }}>{(s.school_name || 'S')[0]}</span><b>{s.school_name}</b></a>
          <div className="auth-caption">
            <h1>Welcome back</h1>
            <p>{s.tagline || 'Everyone sees only what is theirs.'}</p>
            <div className="glass-row">{[['01', 'Staff'], ['02', 'Parents'], ['03', 'Students']].map(([n, l], i) => <div key={n} className={'glass' + (i === 0 ? ' on' : '')}><span>{n}</span>{l}</div>)}</div>
          </div>
        </aside>
        <main className="auth-form">
          <form onSubmit={submit}>
            <h2>{mfa ? 'Verification code' : 'Sign in to your account'}</h2>
            <p className="sub">{mfa ? 'Enter the 6-digit code from your authenticator app.' : 'Use the login ID given to you by the school.'}</p>
            {err && <div className="notice error" role="alert" style={{ marginBottom: '1rem' }}>{err}</div>}
            {!mfa ? <>
              <div className="field"><label htmlFor="li">Login ID</label><input id="li" type="text" autoComplete="username" required value={loginId} onChange={(e) => setLoginId(e.target.value)} autoCapitalize="none" placeholder="e.g. name@school.org" /></div>
              <div className="field"><label htmlFor="pw">Password</label><input id="pw" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Your password" /></div>
            </> : <div className="field"><label htmlFor="otp">Code</label><input id="otp" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required autoFocus value={otp} onChange={(e) => setOtp(e.target.value)} placeholder="123456" /></div>}
            <button className="auth-btn" disabled={busy}>{busy ? 'Signing in…' : mfa ? 'Verify' : 'Sign in'}</button>
            <p className="hint">Forgotten your password? Ask the school office to reset it.</p>
            <p className="hint"><a href="/">← Back to the website</a></p>
          </form>
        </main>
      </div>
    </div>
  );
}
