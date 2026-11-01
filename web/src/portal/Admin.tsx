import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, ApiError, qs } from '../api';
import { useAuth } from '../auth';
import { Modal } from '../components/Modal';
import { Tabs } from '../components/Tabs';
import { Empty, ErrorBox, Loading } from '../components/States';
import { fmtDate } from '../lib';
import { DynamicForm } from './DynamicForm';
import { useSchema } from './schema';

const dt = (v: string) => fmtDate(v, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
function Pager({ page, total, size, onPage }: { page: number; total: number; size: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / size));
  return <div className="pager"><span>{total} record{total === 1 ? '' : 's'}</span><button className="btn ghost sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button><span>Page {page} of {pages}</span><button className="btn ghost sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button></div>;
}

/* ---------- Inbox (enquiries & contact messages) ---------- */
export function Inbox() {
  const [sp, setSp] = useSearchParams();
  const kind = (sp.get('kind') ?? 'enquiries') as 'enquiries' | 'messages';
  return <InboxKind kind={kind} onKind={(k) => setSp({ kind: k })} />;
}
export function InboxRoute({ kind }: { kind: 'enquiries' | 'messages' }) { return <InboxKind kind={kind} />; }

function InboxKind({ kind, onKind }: { kind: 'enquiries' | 'messages'; onKind?: (k: any) => void }) {
  const [sp] = useSearchParams();
  const [rows, setRows] = useState<any[]>([]); const [total, setTotal] = useState(0); const [page, setPage] = useState(1);
  const [q, setQ] = useState(''); const [status, setStatus] = useState('');
  const [statuses, setStatuses] = useState<string[]>([]);
  const [loading, setLoading] = useState(true); const [err, setErr] = useState('');
  const [sel, setSel] = useState<any | null>(null); const [notes, setNotes] = useState(''); const [del, setDel] = useState(false);
  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try { const r = await api(`/admin/inbox/${kind}${qs({ q, status, page })}`); setRows(r.rows); setTotal(r.total); setStatuses(r.statuses); const open = Number(sp.get('open')); if (open) setSel((s: any) => s ?? r.rows.find((x: any) => x.id === open) ?? null); }
    catch (e) { setErr((e as ApiError).message); } finally { setLoading(false); }
  }, [kind, q, status, page]); // eslint-disable-line
  useEffect(() => { setPage(1); setStatus(''); setQ(''); }, [kind]);
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);
  useEffect(() => { setNotes(sel?.notes ?? ''); setDel(false); }, [sel]);

  async function patch(body: any) {
    try { await api(`/admin/inbox/${kind}/${sel.id}`, { method: 'PATCH', body }); setSel({ ...sel, ...body }); await load(); } catch (e) { setErr((e as ApiError).message); }
  }
  async function remove() { try { await api(`/admin/inbox/${kind}/${sel.id}`, { method: 'DELETE' }); setSel(null); await load(); } catch (e) { setErr((e as ApiError).message); } }
  const isEnq = kind === 'enquiries';
  return (
    <>
      <div className="ph1"><h1>{isEnq ? 'Admission enquiries' : 'Contact messages'}</h1></div>
      {onKind && <Tabs tabs={[{ id: 'enquiries', label: 'Admission enquiries' }, { id: 'messages', label: 'Contact messages' }]} value={kind} onChange={onKind} />}
      <div className="toolbar">
        <input className="input" type="search" placeholder="Search name, phone, email" aria-label="Search" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        <select className="input" style={{ maxWidth: 170 }} aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">All statuses</option>{statuses.map((s) => <option key={s}>{s}</option>)}</select>
      </div>
      {err && <ErrorBox message={err} />}
      {loading ? <Loading /> : rows.length === 0 ? <Empty>Nothing here yet. New submissions from the website appear here.</Empty> : (
        <div className="tbl-wrap"><table className="tbl"><thead><tr>{isEnq ? <><th>Child</th><th>Class</th><th>Parent</th></> : <><th>From</th><th>Subject</th></>}<th>Received</th><th>Status</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => { setSel(r); if (!isEnq && r.status === 'new') api(`/admin/inbox/messages/${r.id}`, { method: 'PATCH', body: { status: 'read' } }).then(load).catch(() => {}); }}>
            {isEnq ? <><td><b>{r.student_name}</b></td><td>{r.grade_applying}</td><td>{r.parent_name}</td></> : <><td><b>{r.name}</b></td><td>{r.subject}</td></>}
            <td>{dt(r.created_at)}</td><td><span className={'badge ' + r.status}>{r.status}</span></td></tr>)}</tbody></table></div>)}
      <Pager page={page} total={total} size={20} onPage={setPage} />
      <Modal open={!!sel} onClose={() => setSel(null)} label="Details">
        {sel && <>
          <h3>{isEnq ? sel.student_name : sel.subject}</h3>
          <dl className="kv">
            {isEnq ? <><dt>Class</dt><dd>{sel.grade_applying}</dd><dt>Parent</dt><dd>{sel.parent_name}</dd></> : <><dt>From</dt><dd>{sel.name}</dd></>}
            {sel.phone && <><dt>Phone</dt><dd><a href={`tel:${sel.phone}`}>{sel.phone}</a></dd></>}
            {sel.email && <><dt>Email</dt><dd><a href={`mailto:${sel.email}`}>{sel.email}</a></dd></>}
            <dt>Received</dt><dd>{dt(sel.created_at)}</dd>
            <dt>Consent</dt><dd>{sel.consent_purpose} (notice v{sel.consent_notice_version})</dd>
            {sel.message && <><dt>Message</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{sel.message}</dd></>}
          </dl>
          <div className="field" style={{ marginTop: '1rem' }}><label htmlFor="st">Status</label>
            <select id="st" value={sel.status} onChange={(e) => patch({ status: e.target.value })}>{statuses.map((s) => <option key={s}>{s}</option>)}</select></div>
          {isEnq && <div className="field"><label htmlFor="nt">Staff notes</label><textarea id="nt" value={notes} onChange={(e) => setNotes(e.target.value)} /><button className="btn ghost sm" style={{ width: 'fit-content' }} onClick={() => patch({ notes })}>Save notes</button></div>}
          {!del ? <div className="flex"><button className="btn ghost" onClick={() => setSel(null)}>Close</button><button className="btn ghost" onClick={() => setDel(true)}>Delete…</button></div>
            : <div className="notice error"><p>Delete this record permanently?</p><div className="flex"><button className="btn danger sm" onClick={remove}>Yes, delete</button><button className="btn ghost sm" onClick={() => setDel(false)}>Keep</button></div></div>}
        </>}
      </Modal>
    </>
  );
}

/* ---------- Site settings ---------- */
export function SettingsPage() {
  const { schema } = useSchema();
  const [vals, setVals] = useState<Record<string, string> | null>(null);
  const [tab, setTab] = useState(''); const [saved, setSaved] = useState(false);
  useEffect(() => { api('/admin/cms/settings').then(setVals).catch(() => {}); }, []);
  if (!schema || !vals) return <Loading />;
  const groups = [...new Set<string>(schema.settings.map((f: any) => f.group))];
  const cur = tab || groups[0];
  const fields = schema.settings.filter((f: any) => f.group === cur);
  return (
    <>
      <div className="ph1"><h1>Site settings</h1></div>
      <Tabs tabs={groups.map((g) => ({ id: g, label: g }))} value={cur} onChange={(g) => { setTab(g); setSaved(false); }} />
      <div className="panel" style={{ maxWidth: 780 }}>
        {saved && <div className="notice ok" role="status" style={{ marginBottom: '1rem' }}>Settings saved and live on the website.</div>}
        <DynamicForm key={cur} fields={fields} initial={vals} submitLabel="Save settings"
          onSubmit={async (data) => {
            const body: Record<string, string> = {};
            for (const f of fields) body[f.name] = data[f.name] == null ? '' : String(data[f.name]);
            await api('/admin/cms/settings', { method: 'PUT', body }); setVals({ ...vals, ...body }); setSaved(true);
          }} />
      </div>
    </>
  );
}

/* ---------- Users & roles ---------- */
export function UsersPage() {
  const { me } = useAuth();
  const [roles, setRoles] = useState<{ code: string; name: string; description: string }[]>([]);
  const [rows, setRows] = useState<any[]>([]); const [total, setTotal] = useState(0); const [page, setPage] = useState(1);
  const [q, setQ] = useState(''); const [role, setRole] = useState('');
  const [loading, setLoading] = useState(true); const [err, setErr] = useState('');
  const [edit, setEdit] = useState<any | 'new' | null>(null);
  const [secret, setSecret] = useState<{ title: string; pw: string } | null>(null);
  const isSuper = me!.roles.includes('super_admin');
  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try { const r = await api(`/admin/users${qs({ q, role, page })}`); setRows(r.rows); setTotal(r.total); } catch (e) { setErr((e as ApiError).message); } finally { setLoading(false); }
  }, [q, role, page]);
  useEffect(() => { api('/admin/users/roles').then(setRoles).catch(() => {}); }, []);
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);
  const assignable = roles.filter((r) => isSuper || r.code !== 'super_admin');
  return (
    <>
      <div className="ph1"><h1>Users & roles</h1><button className="btn" onClick={() => setEdit('new')}>Add user</button></div>
      <div className="toolbar">
        <input className="input" type="search" placeholder="Search name, login ID, email" aria-label="Search" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        <select className="input" style={{ maxWidth: 200 }} aria-label="Role" value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }}><option value="">All roles</option>{roles.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}</select>
      </div>
      {err && <ErrorBox message={err} />}
      {loading ? <Loading /> : rows.length === 0 ? <Empty>No users match.</Empty> : (
        <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Name</th><th>Login ID</th><th>Roles</th><th>2-step</th><th>Last sign-in</th><th>Status</th><th /></tr></thead>
          <tbody>{rows.map((u) => <tr key={u.id}><td><b>{u.display_name}</b></td><td>{u.login_id}</td><td>{u.roles.map((r: string) => roles.find((x) => x.code === r)?.name ?? r).join(', ')}</td><td>{u.mfa_enabled ? 'On' : 'Off'}</td><td>{u.last_login_at ? dt(u.last_login_at) : 'Never'}</td><td><span className={'badge ' + u.status}>{u.status}</span></td><td className="act"><button className="btn ghost sm" onClick={() => setEdit(u)}>Manage</button></td></tr>)}</tbody></table></div>)}
      <Pager page={page} total={total} size={25} onPage={setPage} />
      <UserModal edit={edit} roles={assignable} allRoles={roles} onClose={() => setEdit(null)} onSecret={(title: string, pw: string) => setSecret({ title, pw })} onDone={load} />
      <Modal open={!!secret} onClose={() => setSecret(null)} label="Temporary password">
        {secret && <><h3>{secret.title}</h3><p>Give this temporary password to the user securely. <b>It will not be shown again.</b> They must choose a new password at first sign-in.</p>
          <p><code style={{ fontSize: '1.3rem', background: 'var(--olive-soft)', padding: '.5rem .8rem', borderRadius: 8, userSelect: 'all' }}>{secret.pw}</code></p>
          <button className="btn" onClick={() => setSecret(null)}>Done</button></>}
      </Modal>
    </>
  );
}

function UserModal({ edit, roles, allRoles, onClose, onSecret, onDone }: any) {
  const isNew = edit === 'new';
  const [f, setF] = useState<any>({}); const [err, setErr] = useState<ApiError | null>(null); const [busy, setBusy] = useState(false);
  useEffect(() => { setErr(null); setF(isNew ? { loginId: '', displayName: '', email: '', roles: [] } : edit ? { displayName: edit.display_name, email: edit.email ?? '', roles: edit.roles, status: edit.status } : {}); }, [edit, isNew]);
  const toggle = (c: string) => setF((x: any) => ({ ...x, roles: x.roles.includes(c) ? x.roles.filter((r: string) => r !== c) : [...x.roles, c] }));
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      if (isNew) { const r = await api('/admin/users', { method: 'POST', body: f }); onClose(); onSecret(`Account created for ${f.displayName}`, r.temporaryPassword); }
      else { await api(`/admin/users/${edit.id}`, { method: 'PATCH', body: { displayName: f.displayName, email: f.email, roles: f.roles, status: f.status } }); onClose(); }
      onDone();
    } catch (x) { setErr(x as ApiError); } finally { setBusy(false); }
  }
  async function reset() {
    if (!confirm(`Reset the password for ${edit.display_name}? They will be signed out everywhere.`)) return;
    try { const r = await api(`/admin/users/${edit.id}/reset-password`, { method: 'POST' }); onClose(); onSecret(`New password for ${edit.display_name}`, r.temporaryPassword); onDone(); } catch (x) { setErr(x as ApiError); }
  }
  return (
    <Modal open={!!edit} onClose={onClose} label="User">
      {edit && f.roles && <form onSubmit={save}>
        <h3>{isNew ? 'Add user' : 'Manage user'}</h3>
        {err && <div className="notice error" role="alert" style={{ marginBottom: '1rem' }}>{err.message}</div>}
        {isNew && <div className="field"><label htmlFor="u1">Login ID *</label><input id="u1" type="text" required value={f.loginId} onChange={(e) => setF({ ...f, loginId: e.target.value })} /><span className="help">What they type to sign in, e.g. an email address or staff code.</span></div>}
        <div className="field"><label htmlFor="u2">Full name *</label><input id="u2" type="text" required value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} /></div>
        <div className="field"><label htmlFor="u3">Email</label><input id="u3" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
        <div className="field"><span className="lbl">Roles *</span>{allRoles.filter((r: any) => roles.some((a: any) => a.code === r.code) || f.roles.includes(r.code)).map((r: any) => <label key={r.code} className="check"><input type="checkbox" checked={f.roles.includes(r.code)} disabled={!roles.some((a: any) => a.code === r.code)} onChange={() => toggle(r.code)} /><span><b>{r.name}</b><br /><span className="muted" style={{ fontSize: '.8rem' }}>{r.description}</span></span></label>)}</div>
        {!isNew && <div className="field"><label htmlFor="u4">Account status</label><select id="u4" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="active">Active</option><option value="suspended">Suspended (cannot sign in)</option></select></div>}
        <div className="flex"><button className="btn" disabled={busy}>{busy ? 'Saving…' : isNew ? 'Create account' : 'Save'}</button><button type="button" className="btn ghost" onClick={onClose}>Cancel</button>{!isNew && <button type="button" className="btn ghost" onClick={reset}>Reset password</button>}</div>
      </form>}
    </Modal>
  );
}

/* ---------- Audit log ---------- */
export function AuditPage() {
  const [rows, setRows] = useState<any[]>([]); const [total, setTotal] = useState(0); const [page, setPage] = useState(1); const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true); const [err, setErr] = useState('');
  useEffect(() => {
    const t = setTimeout(async () => { setLoading(true); try { const r = await api(`/admin/audit${qs({ q, page })}`); setRows(r.rows); setTotal(r.total); setErr(''); } catch (e) { setErr((e as ApiError).message); } finally { setLoading(false); } }, 200);
    return () => clearTimeout(t);
  }, [q, page]);
  return (
    <>
      <div className="ph1"><h1>Audit log</h1></div>
      <div className="toolbar"><input className="input" type="search" placeholder="Search action, record type or person" aria-label="Search" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></div>
      {err && <ErrorBox message={err} />}
      {loading ? <Loading /> : rows.length === 0 ? <Empty>No activity recorded.</Empty> : <div className="tbl-wrap"><table className="tbl"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Record</th><th>IP</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id}><td>{dt(r.at)}</td><td>{r.user_name ?? <span className="muted">system</span>}</td><td><code>{r.action}</code></td><td>{[r.entity, r.entity_id].filter(Boolean).join(' · ')}</td><td>{r.ip}</td></tr>)}</tbody></table></div>}
      <Pager page={page} total={total} size={30} onPage={setPage} />
    </>
  );
}

/* ---------- My account ---------- */
export function AccountPage() {
  const { me, refresh } = useAuth();
  const [cur, setCur] = useState(''); const [pw, setPw] = useState(''); const [pw2, setPw2] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null); const [fe, setFe] = useState<Record<string, string>>({});
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null); const [otp, setOtp] = useState(''); const [mfaPw, setMfaPw] = useState('');
  async function change(e: React.FormEvent) {
    e.preventDefault(); setMsg(null); setFe({});
    if (pw !== pw2) { setFe({ newPassword: 'Passwords do not match' }); return; }
    try { await api('/auth/change-password', { method: 'POST', body: { currentPassword: cur, newPassword: pw } }); setMsg({ ok: true, t: 'Password changed. Other devices were signed out.' }); setCur(''); setPw(''); setPw2(''); await refresh(); }
    catch (x) { setMsg({ ok: false, t: (x as ApiError).message }); setFe((x as ApiError).fields ?? {}); }
  }
  async function mfa(fn: () => Promise<void>) { setMsg(null); try { await fn(); } catch (x) { setMsg({ ok: false, t: (x as ApiError).message }); } }
  return (
    <>
      <div className="ph1"><h1>My account</h1></div>
      {me!.user.mustChangePassword && <div className="notice" style={{ marginBottom: '1rem' }}>Please choose a new password before continuing.</div>}
      {msg && <div className={'notice ' + (msg.ok ? 'ok' : 'error')} role="status" style={{ marginBottom: '1rem' }}>{msg.t}</div>}
      <div className="grid-2" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))' }}>
        <form className="panel" onSubmit={change}>
          <h2>Change password</h2>
          <div className={'field' + (fe.currentPassword ? ' invalid' : '')}><label htmlFor="a1">Current password</label><input id="a1" type="password" autoComplete="current-password" required value={cur} onChange={(e) => setCur(e.target.value)} />{fe.currentPassword && <span className="err">{fe.currentPassword}</span>}</div>
          <div className={'field' + (fe.newPassword ? ' invalid' : '')}><label htmlFor="a2">New password</label><input id="a2" type="password" autoComplete="new-password" required value={pw} onChange={(e) => setPw(e.target.value)} /><span className="help">At least 10 characters, with letters and numbers.</span>{fe.newPassword && <span className="err">{fe.newPassword}</span>}</div>
          <div className="field"><label htmlFor="a3">Repeat new password</label><input id="a3" type="password" autoComplete="new-password" required value={pw2} onChange={(e) => setPw2(e.target.value)} /></div>
          <button className="btn">Change password</button>
        </form>
        <div className="panel">
          <h2>Two-step verification</h2>
          <p className="muted">Adds a 6-digit code from an authenticator app to your sign-in. Recommended for all staff with administrative access.</p>
          {me!.user.mfaEnabled ? <>
            <p><span className="badge on">On</span></p>
            <div className="field"><label htmlFor="m1">Password</label><input id="m1" type="password" value={mfaPw} onChange={(e) => setMfaPw(e.target.value)} /></div>
            <div className="field"><label htmlFor="m2">Current code</label><input id="m2" type="text" inputMode="numeric" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value)} /></div>
            <button className="btn ghost" onClick={() => mfa(async () => { await api('/auth/mfa/disable', { method: 'POST', body: { password: mfaPw, otp } }); setOtp(''); setMfaPw(''); await refresh(); setMsg({ ok: true, t: 'Two-step verification turned off.' }); })}>Turn off</button>
          </> : setup ? <>
            <p>Add this key to your authenticator app (choose “enter a setup key”), then type the 6-digit code it shows.</p>
            <p><code style={{ background: 'var(--olive-soft)', padding: '.4rem .7rem', borderRadius: 8, userSelect: 'all', wordBreak: 'break-all' }}>{setup.secret}</code></p>
            <div className="field"><label htmlFor="m3">6-digit code</label><input id="m3" type="text" inputMode="numeric" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value)} /></div>
            <button className="btn" onClick={() => mfa(async () => { await api('/auth/mfa/enable', { method: 'POST', body: { otp } }); setSetup(null); setOtp(''); await refresh(); setMsg({ ok: true, t: 'Two-step verification is on.' }); })}>Turn on</button>
          </> : <button className="btn" onClick={() => mfa(async () => setSetup(await api('/auth/mfa/setup', { method: 'POST' })))}>Set up</button>}
        </div>
      </div>
    </>
  );
}
